import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteParticipant } from "livekit-client";
import ParticipantTile, { participantHasMedia } from "./ParticipantTile";
import { apiRequest, ApiError } from "../../lib/apiClient";
import {
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, MonitorIcon, MessageCircleIcon,
  // MicIcon doubles as the icon-only "speaking now" badge on tiles below —
  // deliberately no text label per the design ask (icon + colour only).
  UserXIcon, UsersIcon, XIcon, ArrowLeftIcon, ShieldIcon, MoreVerticalIcon,
  HandIcon, SearchIcon, SendIcon, SignalIcon,
} from "../common/Icons";

export interface MeetingInfo {
  id: string;
  title: string;
  description: string;
  roomName: string;
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
  scheduledAt: string;
  startedAt?: string | null;
  recordingStatus?: "NONE" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";
  course?: { id: string; title: string } | null;
}

type ChatMessage = { id: string; sender: string; text: string; own: boolean };

const PARTICIPANT_REMOVE_GRACE_MS = 1500;

// Refresh/close is expected to happen mid-call (bad wifi kicks the tab,
// someone hits F5 out of habit, phone browser reclaims memory and
// reloads the tab when it comes back to the foreground). Two things
// make that not feel like getting bounced from class:
//
// 1. Remember whether this device had mic/camera on, per-meeting, in
//    sessionStorage. A refresh gets a brand new Room + brand new
//    getUserMedia() calls — there is no way to hand a live MediaStream
//    across a full page reload — but we can at least rejoin in the
//    same on/off state instead of always snapping back to "camera on"
//    for someone who had deliberately muted.
// 2. A raw page reload doesn't reliably let React finish its unmount
//    cleanup before the tab is gone, so we also disconnect from a
//    `pagehide` listener as a best-effort belt-and-suspenders — this
//    is what makes the LiveKit server see an explicit leave quickly
//    instead of waiting out its own connection timeout, which is what
//    the "ghost tile that lingers for a bit after you refresh" is.
function mediaPrefsKey(meetingId: string) {
  return `meeting:${meetingId}:media-prefs`;
}
function readMediaPrefs(meetingId: string): { mic: boolean; cam: boolean } {
  try {
    const raw = sessionStorage.getItem(mediaPrefsKey(meetingId));
    if (!raw) return { mic: true, cam: true };
    const parsed = JSON.parse(raw);
    return { mic: parsed.mic !== false, cam: parsed.cam !== false };
  } catch {
    return { mic: true, cam: true };
  }
}
function writeMediaPrefs(meetingId: string, prefs: { mic: boolean; cam: boolean }) {
  try {
    sessionStorage.setItem(mediaPrefsKey(meetingId), JSON.stringify(prefs));
  } catch { /* sessionStorage unavailable (private mode etc.) — not worth failing over */ }
}

export default function MeetingRoom({ token, wsUrl, meeting, onLeave, isAdmin }: {
  token: string;
  wsUrl: string;
  meeting: MeetingInfo;
  onLeave: () => void;
  isAdmin: boolean;
}) {
  const roomRef = useRef<Room | null>(null);
  // Per-identity join timestamps, used only to gate when the "Remove"
  // moderation button appears on a tile — see the ParticipantConnected
  // handler below and the participants.map() render for how this is
  // used.
  const joinTimesRef = useRef<Map<string, number>>(new Map());
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState<string | null>(null);

  // --- Presentation-only UI state below. Sidebar tab + a couple of
  // static info popovers — matching the new meeting UI layout.
  const [sidebarTab, setSidebarTab] = useState<"participants" | "chat">("chat");
  const [participantSearch, setParticipantSearch] = useState("");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);
  // Bottom-bar "More" popover — students only (see footer). Separate
  // from `showMoreMenu` above, which is the header's own overflow menu;
  // the two are independent popovers on independent buttons.
  const [footerMoreOpen, setFooterMoreOpen] = useState(false);

  // --- Raise hand. This one DOES touch real state shared with everyone
  // else in the room: whether the *local* participant's hand is up
  // drives the footer button, and `raisedHands` is the full roster of
  // who currently has a hand raised, keyed by identity, kept in sync
  // across every client over the room's data channel (topic "hand") the
  // same way chat messages already travel. A student raising a hand is
  // pointless if the teacher never finds out, so this needs to actually
  // reach everyone else, not just flip a local flag.
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Record<string, { name: string; ts: number }>>({});
  const raisedHandCount = Object.keys(raisedHands).length;

  // Real recording state — driven by meeting.recordingStatus, which the
  // backend already sets when LiveKit Egress actually starts/stops (see
  // meetingRecordingService.js). Not a UI-only flag: if the deployment
  // has no egress configured, recordingStatus stays "NONE"/undefined and
  // this indicator simply never shows.
  const isRecording = meeting.recordingStatus === "RECORDING";
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    if (!isRecording) return;
    const startedAtMs = meeting.startedAt ? new Date(meeting.startedAt).getTime() : Date.now();
    const tick = () => setRecordingSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isRecording, meeting.startedAt]);

  function formatRecordingTime(totalSeconds: number) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  useEffect(() => {
    let active = true;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const rerender = () => active && setRefresh((v) => v + 1);
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!active) return;
      if (topic === "chat") {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as { text?: string; id?: string };
          const text = data.text;
          if (!text || !participant) return;
          setMessages((prev) => [...prev, { id: data.id || crypto.randomUUID(), sender: participant.name || participant.identity, text, own: false }]);
        } catch { /* Ignore malformed room data. */ }
      } else if (topic === "hand" && participant) {
        // Broadcast from toggleHand() below on every OTHER client — the
        // local participant updates its own `raisedHands` entry directly
        // when it toggles, since LiveKit doesn't echo your own published
        // data back to you.
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as { raised?: boolean };
          setRaisedHands((prev) => {
            if (data.raised) {
              return { ...prev, [participant.identity]: { name: participant.name || participant.identity, ts: Date.now() } };
            }
            if (!(participant.identity in prev)) return prev;
            const next = { ...prev };
            delete next[participant.identity];
            return next;
          });
        } catch { /* Ignore malformed room data. */ }
      }
    };

    room.on(RoomEvent.TrackSubscribed, rerender);
    room.on(RoomEvent.TrackUnsubscribed, rerender);
    // Drives the speaking-highlight ring/icon on tiles below — LiveKit
    // already computes who's actively talking from real audio levels
    // (not just "mic unmuted") and fires this whenever that set changes,
    // so each participant's own `.isSpeaking` stays accurate without us
    // polling anything.
    room.on(RoomEvent.ActiveSpeakersChanged, rerender);
    // Bug fix: the "Remove" moderation button used to render the
    // instant a participant showed up in the list — before their
    // camera/mic track had actually been subscribed and drawn — so
    // admins briefly saw a floating Remove button over an empty black
    // tile, as if you could remove someone before you'd even seen them
    // join. `participants.map()` below now only shows Remove once the
    // tile has real media OR this grace period has passed (covers
    // participants who never turn on camera/mic at all, so they don't
    // become permanently un-removable). The extra timeout here is what
    // flips that grace period even if no further room event happens to
    // trigger a re-render on its own.
    room.on(RoomEvent.ParticipantConnected, (p) => {
      joinTimesRef.current.set(p.identity, Date.now());
      rerender();
      window.setTimeout(rerender, PARTICIPANT_REMOVE_GRACE_MS + 50);
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      // A participant who leaves with their hand up shouldn't leave a
      // ghost entry in the raised-hands roster behind them.
      setRaisedHands((prev) => {
        if (!(p.identity in prev)) return prev;
        const next = { ...prev };
        delete next[p.identity];
        return next;
      });
      rerender();
    });
    room.on(RoomEvent.LocalTrackPublished, rerender);
    room.on(RoomEvent.LocalTrackUnpublished, rerender);
    room.on(RoomEvent.TrackMuted, rerender);
    room.on(RoomEvent.TrackUnmuted, rerender);
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Disconnected, () => active && setConnected(false));
    // LiveKit's own client already retries on transient network drops
    // before it ever gives up and fires Disconnected above — these two
    // just let the UI say something during that retry window instead
    // of leaving the tiles looking frozen with no explanation.
    room.on(RoomEvent.Reconnecting, () => active && setReconnecting(true));
    room.on(RoomEvent.Reconnected, () => active && setReconnecting(false));

    // Best-effort clean leave on refresh/close — see the comment above
    // mediaPrefsKey(). Not guaranteed to finish (the tab can vanish
    // mid-flight), but it beats waiting on the server-side timeout.
    const handlePageHide = () => { try { room.disconnect(); } catch { /* best effort */ } };
    window.addEventListener("pagehide", handlePageHide);

    const { mic: wantMic, cam: wantCam } = readMediaPrefs(meeting.id);

    room.connect(wsUrl, token)
      .then(async () => {
        if (!active) return;
        setConnected(true);
        // Anyone already in the room when we connect (the normal case
        // of joining a class in progress) should be removable right
        // away, not after an artificial grace period meant for
        // brand-new joins — backdate their timestamps.
        room.remoteParticipants.forEach((p) => joinTimesRef.current.set(p.identity, 0));
        // Bug fix: publishing the local mic/camera is best-effort, not a
        // precondition for joining. This used to be two bare `await`s
        // inside this .then(), so ANY media failure — permission denied,
        // no camera/mic attached (common on a locked-down classroom
        // laptop or a phone browser), or the device already in use by
        // another app — threw, was caught by the outer .catch() below,
        // and sent the user to the full-page "Unable to join" screen
        // even though the room connection itself had already succeeded.
        // A student without a webcam should still be able to watch and
        // chat, not be locked out of the class entirely. Each device is
        // now enabled independently so a failure on one doesn't block
        // the other, and neither can block joining the room at all.
        try {
          const micPub = wantMic ? await room.localParticipant.setMicrophoneEnabled(true) : null;
          if (active) {
            setMicOn(wantMic);
          } else {
            // The user hit "Leave" (or navigated away) while this getUserMedia
            // call was still in flight. room.disconnect() already ran and
            // stopped whatever was published *at that moment* — but this mic
            // track didn't exist yet, so it was never touched and its
            // permission indicator stays lit forever with nothing left
            // referencing it. Stop it directly now that it's finally here.
            micPub?.track?.stop();
          }
        } catch (err) {
          console.warn("Could not enable microphone:", err);
        }
        try {
          const camPub = wantCam ? await room.localParticipant.setCameraEnabled(true) : null;
          if (active) {
            setCameraOn(wantCam);
          } else {
            // Same race as above, for the camera: without this, leaving the
            // meeting a beat too early leaves the camera's hardware light on
            // with no track reference anywhere to turn it off.
            camPub?.track?.stop();
          }
        } catch (err) {
          console.warn("Could not enable camera:", err);
        }
        rerender();
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Could not join the meeting."));

    return () => {
      active = false;
      window.removeEventListener("pagehide", handlePageHide);
      room.disconnect();
      roomRef.current = null;
    };
  }, [token, wsUrl, meeting.id]);

  const participants = useMemo<Participant[]>(() => {
    const room = roomRef.current;
    if (!room) return [];
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [refresh, connected]);

  // Presentation-only: which existing participant (from the array above)
  // gets the large "spotlight" tile vs. the filmstrip. Prefers whoever is
  // screen-sharing, then falls back to the first participant with a
  // camera on, then just the first participant. Purely a display choice
  // over data that already exists — doesn't change what's subscribed to.
  const spotlightParticipant = useMemo(() => {
    if (participants.length === 0) return null;
    const sharing = participants.find((p) =>
      Array.from(p.videoTrackPublications.values()).some((pub) => !!pub.track && pub.track.source === Track.Source.ScreenShare)
    );
    if (sharing) return sharing;
    const withVideo = participants.find((p) => Array.from(p.videoTrackPublications.values()).some((pub) => !!pub.track));
    return withVideo || participants[0];
  }, [participants]);

  const filmstripParticipants = participants.filter((p) => p !== spotlightParticipant);

  function isMicMuted(participant: { audioTrackPublications: Map<string, { track?: unknown; isMuted?: boolean }> }) {
    const pubs = Array.from(participant.audioTrackPublications.values());
    if (pubs.length === 0) return true;
    return pubs.every((p) => !p.track || p.isMuted);
  }

  function initials(name: string) {
    return name.trim().slice(0, 2).toUpperCase() || "?";
  }

  const filteredParticipantList = participants.filter((p) =>
    (p.name || p.identity).toLowerCase().includes(participantSearch.trim().toLowerCase())
  );

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      writeMediaPrefs(meeting.id, { mic: next, cam: cameraOn });
      setRefresh((v) => v + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not access the microphone.");
    }
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
      writeMediaPrefs(meeting.id, { mic: micOn, cam: next });
      setRefresh((v) => v + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not access the camera.");
    }
  }

  async function toggleScreen() {
    const room = roomRef.current;
    if (!room) return;
    try {
      const next = !screenOn;
      await room.localParticipant.setScreenShareEnabled(next, { audio: false });
      setScreenOn(next);
      setRefresh((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screen sharing could not be started.");
    }
  }

  // Students only (see footer) — the teacher doesn't raise their own
  // hand. Flips the local flag immediately (so the button feels
  // instant even on a slow connection) and updates this client's own
  // entry in `raisedHands` directly, since publishData never echoes
  // back to its own sender — then broadcasts the change so every other
  // participant, especially the admin, sees it too.
  async function toggleHand() {
    const room = roomRef.current;
    if (!room) return;
    const next = !handRaised;
    setHandRaised(next);
    const localId = room.localParticipant.identity;
    setRaisedHands((prev) => {
      if (next) return { ...prev, [localId]: { name: room.localParticipant.name || localId, ts: Date.now() } };
      if (!(localId in prev)) return prev;
      const rest = { ...prev };
      delete rest[localId];
      return rest;
    });
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ raised: next })),
        { reliable: true, topic: "hand" }
      );
    } catch (err) {
      console.warn("Could not broadcast raised hand:", err);
    }
  }

  async function sendChat() {
    const room = roomRef.current;
    const text = chatInput.trim();
    if (!room || !text) return;
    const message = { id: crypto.randomUUID(), text };
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: "chat" });
    setMessages((prev) => [...prev, { id: message.id, sender: room.localParticipant.name || room.localParticipant.identity, text, own: true }]);
    setChatInput("");
  }

  async function removeParticipant(identity: string) {
    if (!isAdmin || !confirm("Remove this participant from the meeting?")) return;
    setModerationBusy(identity);
    try {
      await apiRequest(`/meetings/${meeting.id}/participants/${encodeURIComponent(identity)}`, { method: "DELETE" });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not remove participant.");
    } finally { setModerationBusy(null); }
  }

  function leave() {
    roomRef.current?.disconnect();
    // A deliberate "Leave" (vs. a refresh) means there's no upcoming
    // rejoin to carry a preference into — clear it so a later, separate
    // join of this same meeting starts from the normal on/on default
    // rather than remembering today's mute forever.
    try { sessionStorage.removeItem(mediaPrefsKey(meeting.id)); } catch { /* best effort */ }
    onLeave();
  }

  // Close the chat panel on Escape — applies to both the mobile bottom
  // sheet and the desktop sidebar since both are dismissible overlays/panels.
  useEffect(() => {
    if (!chatOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setChatOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  // Same Escape-to-close for the footer "More" popover (students only).
  useEffect(() => {
    if (!footerMoreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFooterMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [footerMoreOpen]);

  // Shared chat message list + composer JSX, reused in both the mobile
  // bottom sheet and the desktop sidebar so the two surfaces can never
  // drift out of sync. These are plain JSX values (not nested component
  // functions) — a nested function component would get a new identity on
  // every render and force React to remount the <input>, dropping focus
  // on every keystroke.
  const chatMessages = (
    <div className="flex-1 space-y-3 overflow-y-auto">
      {messages.length === 0 && <p className="text-sm text-white/40">No messages yet.</p>}
      {messages.map((m) => (
        <div key={m.id} className="flex items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70">
            {initials(m.sender)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/70">{m.sender}{m.own ? " (You)" : ""}</p>
            <p className={`mt-1 inline-block max-w-full break-words rounded-2xl rounded-tl-sm px-3 py-2 text-sm ${m.own ? "bg-amber-500 text-ink-950" : "bg-white/10 text-white"}`}>
              {m.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  const chatComposer = (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
        placeholder="Type a message…"
        className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30"
      />
      <button
        onClick={() => void sendChat()}
        aria-label="Send message"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-ink-950 transition hover:bg-amber-400"
      >
        <SendIcon className="h-4 w-4" />
      </button>
    </div>
  );

  const participantsList = (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="relative mb-3 shrink-0">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={participantSearch}
          onChange={(e) => setParticipantSearch(e.target.value)}
          placeholder="Search participants"
          className="w-full rounded-full border border-white/10 bg-white/10 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/30"
        />
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {filteredParticipantList.length === 0 && <p className="text-sm text-white/40">No participants found.</p>}
        {filteredParticipantList.map((p) => (
          <div key={p.identity} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-white/5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80">
              {initials(p.name || p.identity)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{p.name || p.identity}{p.isLocal ? " (You)" : ""}</p>
              {isAdmin && p.isLocal && <p className="text-[11px] text-amber-400">Host</p>}
            </div>
            {p.identity in raisedHands && (
              <HandIcon aria-label="Hand raised" className="h-4 w-4 shrink-0 text-amber-400" />
            )}
            {isMicMuted(p) ? <MicOffIcon className="h-4 w-4 shrink-0 text-red-400" /> : <MicIcon className="h-4 w-4 shrink-0 text-emerald-400" />}
            {isAdmin && !p.isLocal &&
              (participantHasMedia(p) || Date.now() - (joinTimesRef.current.get(p.identity) ?? 0) > PARTICIPANT_REMOVE_GRACE_MS) && (
              <button
                disabled={moderationBusy === p.identity}
                onClick={() => removeParticipant(p.identity)}
                aria-label={`Remove ${p.name || p.identity}`}
                className="shrink-0 rounded-full p-1.5 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <MoreVerticalIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 px-5 text-white">
        <div className="max-w-md rounded-2xl bg-white/10 p-6 text-center">
          <h1 className="font-display text-xl font-semibold">Unable to join</h1>
          <p className="mt-2 text-sm text-white/70">{error}</p>
          <button onClick={onLeave} className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-semibold text-ink-950">Go back</button>
        </div>
      </div>
    );
  }

  const scheduledTime = (() => {
    try {
      return new Date(meeting.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch { return null; }
  })();

  const sidebarPanel = (
    <>
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="font-display font-semibold">{sidebarTab === "participants" ? `Participants (${participants.length})` : "Live Chat"}</h2>
        <div className="flex items-center gap-1 rounded-full bg-white/5 p-1">
          <button
            onClick={() => setSidebarTab("participants")}
            className={`rounded-full p-1.5 transition ${sidebarTab === "participants" ? "bg-amber-500 text-ink-950" : "text-white/50 hover:text-white"}`}
            aria-label="Show participants"
          >
            <UsersIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSidebarTab("chat")}
            className={`rounded-full p-1.5 transition ${sidebarTab === "chat" ? "bg-amber-500 text-ink-950" : "text-white/50 hover:text-white"}`}
            aria-label="Show chat"
          >
            <MessageCircleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {sidebarTab === "participants" ? participantsList : <>{chatMessages}{chatComposer}</>}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-white">
      {/* Screen-recording-style indicator: a floating pill fixed to the
          top-center of the screen with a pulsing red dot and a live
          mm:ss timer, the same visual language as macOS/Zoom's "this is
          being recorded" overlay. Only rendered when the meeting is
          actually being recorded server-side. */}
      {isRecording && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="tracking-wide">REC</span>
            <span className="tabular-nums text-white/70">{formatRecordingTime(recordingSeconds)}</span>
          </div>
        </div>
      )}

      <header className="relative flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={leave} aria-label="Back" className="shrink-0 rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display font-semibold">{meeting.title}</p>
            <div className="flex items-center gap-2">
              <p className="truncate text-xs text-white/50">{scheduledTime ? `${scheduledTime} · ` : ""}{meeting.course?.title || "Live class"}</p>
              {reconnecting ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Reconnecting
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Live
                </span>
              )}
              {isRecording && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Recording
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <span className="hidden rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300 sm:inline">Host</span>
          )}
          {/* Admin-only alert: raised hands are meaningless to a teacher
              unless they're actually surfaced somewhere the teacher will
              see it, not just quietly tracked in state. Tapping it jumps
              straight to the participants list, where each raised hand
              is also flagged individually (see participantsList above). */}
          {isAdmin && raisedHandCount > 0 && (
            <button
              onClick={() => { setChatOpen(true); setSidebarTab("participants"); }}
              className="flex animate-pulse items-center gap-1.5 rounded-full bg-amber-500 px-3 py-2 text-xs font-semibold text-ink-950 transition hover:bg-amber-400"
            >
              <HandIcon className="h-4 w-4" /> {raisedHandCount}
            </button>
          )}
          <button
            onClick={() => { setChatOpen(true); setSidebarTab("participants"); }}
            className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15 sm:flex"
          >
            <UsersIcon className="h-4 w-4" /> {participants.length}
          </button>
          <div className="relative">
            <button
              onClick={() => { setShowSecurityInfo((v) => !v); setShowMoreMenu(false); }}
              aria-label="Meeting security info"
              className="rounded-full p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <ShieldIcon className="h-4 w-4" />
            </button>
            {showSecurityInfo && (
              <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-white/10 bg-ink-900 p-3 text-xs text-white/70 shadow-2xl">
                This meeting is encrypted in transit. Only invited participants for this course can join.
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => { setShowMoreMenu((v) => !v); setShowSecurityInfo(false); }}
              aria-label="More options"
              className="rounded-full p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <MoreVerticalIcon className="h-4 w-4" />
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-white/10 bg-ink-900 p-1 text-sm shadow-2xl">
                <button
                  onClick={() => { navigator.clipboard?.writeText(window.location.href); setShowMoreMenu(false); }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                >
                  Copy meeting link
                </button>
                {meeting.description && (
                  <p className="border-t border-white/10 px-3 py-2 text-xs text-white/40">{meeting.description}</p>
                )}
              </div>
            )}
          </div>
          <button onClick={leave} className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500">
            Leave Meeting
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3 sm:p-5">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3">
          {/* Spotlight tile */}
          {spotlightParticipant && (
            <div
              className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-ink-950 shadow-card transition-shadow duration-150 ${
                spotlightParticipant.isSpeaking ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-950" : ""
              }`}
            >
              <ParticipantTile participant={spotlightParticipant} refresh={refresh} handRaised={spotlightParticipant.identity in raisedHands} />
              <div className="absolute left-3 top-3 flex items-center gap-2">
                {isAdmin && spotlightParticipant.isLocal && (
                  <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-ink-950">Teacher</span>
                )}
                {spotlightParticipant.isSpeaking && (
                  <span
                    aria-label="Speaking"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-4 ring-emerald-500/30 animate-pulse"
                  >
                    <MicIcon className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-emerald-400">
                <SignalIcon className="h-4 w-4" />
              </div>
              {isAdmin && !spotlightParticipant.isLocal &&
                (participantHasMedia(spotlightParticipant) || Date.now() - (joinTimesRef.current.get(spotlightParticipant.identity) ?? 0) > PARTICIPANT_REMOVE_GRACE_MS) && (
                <button
                  disabled={moderationBusy === spotlightParticipant.identity}
                  onClick={() => removeParticipant(spotlightParticipant.identity)}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-red-600 disabled:opacity-50"
                >
                  <UserXIcon className="h-3.5 w-3.5" /> {moderationBusy === spotlightParticipant.identity ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          )}
          {!connected && <p className="py-10 text-center text-sm text-white/60">Connecting to the live class…</p>}

          {/* Filmstrip of everyone else. Two responsive layouts sharing
              the same tiles: on narrow (mobile/portrait) screens this is
              a fixed 2-column grid that scrolls vertically within its
              own bounded height, matching the "class roster" grid look
              of the mobile design — a horizontal-scroll strip doesn't
              work well one-handed on a phone. From `sm` up (tablet
              landscape/desktop, more horizontal room) it switches back
              to the original horizontally-scrolling row of fixed-width
              thumbnails. */}
          {filmstripParticipants.length > 0 && (
            <div className="grid max-h-[38vh] grid-cols-2 gap-3 overflow-y-auto pb-1 sm:flex sm:max-h-none sm:shrink-0 sm:gap-3 sm:overflow-x-auto sm:overflow-y-visible">
              {filmstripParticipants.map((participant) => (
                <div
                  key={participant.identity}
                  className={`relative aspect-video overflow-hidden rounded-xl bg-ink-950 shadow-card transition-shadow duration-150 sm:w-40 sm:shrink-0 ${
                    participant.isSpeaking ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-950" : ""
                  }`}
                >
                  <ParticipantTile participant={participant} refresh={refresh} handRaised={participant.identity in raisedHands} />
                  {participant.isSpeaking ? (
                    <div
                      aria-label="Speaking"
                      className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow ring-2 ring-emerald-500/30 animate-pulse"
                    >
                      <MicIcon className="h-3 w-3" />
                    </div>
                  ) : isMicMuted(participant) && (
                    <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">
                      <MicOffIcon className="h-3 w-3" />
                    </div>
                  )}
                  {isAdmin && !participant.isLocal &&
                    (participantHasMedia(participant) || Date.now() - (joinTimesRef.current.get(participant.identity) ?? 0) > PARTICIPANT_REMOVE_GRACE_MS) && (
                    <button
                      disabled={moderationBusy === participant.identity}
                      onClick={() => removeParticipant(participant.identity)}
                      aria-label="Remove participant"
                      className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-red-600 disabled:opacity-50"
                    >
                      <UserXIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {chatOpen && (
          <>
            {/* Mobile/tablet: bottom sheet, overlaid on top of the video grid */}
            <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Meeting sidebar">
              <div className="absolute inset-0 bg-black/60" onClick={() => setChatOpen(false)} />
              <div className="absolute inset-x-0 bottom-0 flex max-h-[75vh] flex-col rounded-t-2xl border-t border-white/10 bg-ink-950 p-4 shadow-2xl">
                <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />
                <button onClick={() => setChatOpen(false)} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-white/60 hover:bg-white/10">
                  <XIcon className="h-4 w-4" />
                </button>
                {sidebarPanel}
              </div>
            </div>

            {/* Tablet-landscape/desktop: persistent sidebar with both panels */}
            <aside className="hidden w-80 flex-col gap-3 md:flex">
              <div className="flex max-h-64 flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display font-semibold">Participants ({participants.length})</h2>
                </div>
                {participantsList}
              </div>
              <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display font-semibold">Live Chat</h2>
                </div>
                {chatMessages}
                {chatComposer}
              </div>
            </aside>
          </>
        )}
      </main>

      {/* Bottom control bar. Two changes from before:
          - The old standalone red "Leave" circle and the bottom "More"
            button (which toggled `showMoreMenu` but had no popover of
            its own down here — it silently did nothing) are both gone.
            Leaving now lives in exactly one place, the header's back
            arrow / "Leave Meeting" button, instead of two.
          - Controls now split by role instead of showing the same six
            buttons to everyone: the teacher doesn't raise their own
            hand, and a student doesn't need a moderator's "who's here"
            shortcut sitting in their thumb's way, so each role gets a
            leaner bar tailored to what they'd actually reach for. */}
      <footer className="sticky bottom-0 border-t border-white/10 bg-ink-950/95 px-3 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={toggleMic}
            aria-pressed={micOn}
            className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-red-600 text-white hover:bg-red-500"}`}
          >
            {micOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
            {micOn ? "Mute" : "Unmute"}
          </button>
          <button
            onClick={toggleCamera}
            aria-pressed={cameraOn}
            className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${cameraOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-red-600 text-white hover:bg-red-500"}`}
          >
            {cameraOn ? <VideoIcon className="h-5 w-5" /> : <VideoOffIcon className="h-5 w-5" />}
            {cameraOn ? "Stop Video" : "Start Video"}
          </button>

          {/* Screen share: primary, always-visible action for the
              teacher (it's how they present), tucked into the "More"
              popover below for students instead of taking up one of
              their five thumb-reachable slots. */}
          {isAdmin && (
            <button
              onClick={toggleScreen}
              aria-pressed={screenOn}
              className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${screenOn ? "bg-amber-500 text-ink-950 hover:bg-amber-400" : "bg-white/10 text-white hover:bg-white/15"}`}
            >
              <MonitorIcon className="h-5 w-5" />
              {screenOn ? "Stop share" : "Share Screen"}
            </button>
          )}

          {/* Raise hand: students only. Broadcasts over the room's data
              channel (see toggleHand above) so the teacher — and every
              other student — actually sees it, not just a local toggle. */}
          {!isAdmin && (
            <button
              onClick={() => void toggleHand()}
              aria-pressed={handRaised}
              className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${handRaised ? "bg-amber-500 text-ink-950 hover:bg-amber-400" : "bg-white/10 text-white hover:bg-white/15"}`}
            >
              <HandIcon className="h-5 w-5" />
              {handRaised ? "Lower Hand" : "Raise Hand"}
            </button>
          )}

          <button
            onClick={() => { setChatOpen((v) => !(v && sidebarTab === "chat")); setSidebarTab("chat"); }}
            aria-pressed={chatOpen && sidebarTab === "chat"}
            className={`relative flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${chatOpen && sidebarTab === "chat" ? "bg-amber-500 text-ink-950" : "bg-white/10 text-white hover:bg-white/15"}`}
          >
            <MessageCircleIcon className="h-5 w-5" />
            Chat
          </button>

          {/* Participants: a moderator's roster/removal tool, so it
              stays a direct, always-visible button for the teacher.
              Students reach the same list through "More" below instead. */}
          {isAdmin && (
            <button
              onClick={() => { setChatOpen((v) => !(v && sidebarTab === "participants")); setSidebarTab("participants"); }}
              aria-pressed={chatOpen && sidebarTab === "participants"}
              className={`relative flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${chatOpen && sidebarTab === "participants" ? "bg-amber-500 text-ink-950" : "bg-white/10 text-white hover:bg-white/15"}`}
            >
              <span className="relative">
                <UsersIcon className="h-5 w-5" />
                <span className="absolute -right-2 -top-1.5 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-ink-950">{participants.length}</span>
              </span>
              Participants
            </button>
          )}

          {/* Students' "More": a real, working popover (unlike the old
              bottom "More" button, which toggled state with no menu
              attached to it) holding the two actions that didn't get
              their own slot above — screen share and the participant
              roster. */}
          {!isAdmin && (
            <div className="relative">
              <button
                onClick={() => setFooterMoreOpen((v) => !v)}
                aria-expanded={footerMoreOpen}
                className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition ${footerMoreOpen ? "bg-amber-500 text-ink-950" : "bg-white/10 text-white hover:bg-white/15"}`}
              >
                <MoreVerticalIcon className="h-5 w-5" />
                More
              </button>
              {footerMoreOpen && (
                <div className="absolute bottom-full right-0 z-30 mb-2 w-52 rounded-xl border border-white/10 bg-ink-900 p-1 text-sm shadow-2xl">
                  <button
                    onClick={() => { void toggleScreen(); setFooterMoreOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    <MonitorIcon className="h-4 w-4" /> {screenOn ? "Stop sharing screen" : "Share screen"}
                  </button>
                  <button
                    onClick={() => { setChatOpen(true); setSidebarTab("participants"); setFooterMoreOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-white/80 hover:bg-white/10"
                  >
                    <UsersIcon className="h-4 w-4" /> Participants ({participants.length})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
