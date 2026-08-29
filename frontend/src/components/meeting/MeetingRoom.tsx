import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import ParticipantTile, { participantHasMedia } from "./ParticipantTile";
import { apiRequest, ApiError } from "../../lib/apiClient";
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, MonitorIcon, MessageCircleIcon, LogOutIcon, UserXIcon, UsersIcon, XIcon } from "../common/Icons";

export interface MeetingInfo {
  id: string;
  title: string;
  description: string;
  roomName: string;
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
  scheduledAt: string;
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

  useEffect(() => {
    let active = true;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const rerender = () => active && setRefresh((v) => v + 1);
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!active || topic !== "chat") return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as { text?: string; id?: string };
        const text = data.text;
        if (!text || !participant) return;
        setMessages((prev) => [...prev, { id: data.id || crypto.randomUUID(), sender: participant.name || participant.identity, text, own: false }]);
      } catch { /* Ignore malformed room data. */ }
    };

    room.on(RoomEvent.TrackSubscribed, rerender);
    room.on(RoomEvent.TrackUnsubscribed, rerender);
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
    room.on(RoomEvent.ParticipantDisconnected, rerender);
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

  const participants = useMemo(() => {
    const room = roomRef.current;
    if (!room) return [];
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [refresh, connected]);

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
        <div key={m.id} className={m.own ? "text-right" : "text-left"}>
          <p className="text-[10px] text-white/40">{m.sender}</p>
          <p className={`mt-1 inline-block max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.own ? "bg-white text-ink-950" : "bg-white/10"}`}>{m.text}</p>
        </div>
      ))}
    </div>
  );

  const chatComposer = (
    <div className="mt-3 flex gap-2">
      <input
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
        placeholder="Type a message"
        className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
      />
      <button onClick={() => void sendChat()} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-950">Send</button>
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

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0"><p className="truncate font-display font-semibold">{meeting.title}</p><p className="truncate text-xs text-white/50">{meeting.course?.title || "Live class"}</p></div>
        <div className="flex items-center gap-2">
          {reconnecting ? (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Reconnecting…
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              Live
            </span>
          )}
          <button
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${chatOpen ? "bg-amber-500 text-ink-950" : "bg-white/10 text-white hover:bg-white/15"}`}
          >
            <MessageCircleIcon className="h-4 w-4" /> Chat
          </button>
          <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white sm:flex">
            <UsersIcon className="h-4 w-4" /> {participants.length}
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3 sm:p-5">
        {/* Bug fix: a single participant used to sit in a `grid h-fit` row
            with no defined height, so the video element (w-full h-full)
            couldn't compute a real height, fell back to its tiny intrinsic
            size, got stretched full-width, and object-cover cropped that
            into an extreme zoomed sliver. Single participant now fills the
            actual available height with flex; multiple participants keep
            the grid but each tile gets a fixed aspect-video box so the
            video always has real, predictable dimensions to fill. */}
        <div
          className={`mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-3 ${
            participants.length === 1 ? "flex-col" : "grid h-fit content-start sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {participants.map((participant) => (
            <div
              key={participant.identity}
              className={`relative overflow-hidden rounded-2xl bg-ink-950 shadow-card ${
                participants.length === 1 ? "min-h-0 flex-1" : "aspect-video"
              }`}
            >
              <ParticipantTile participant={participant} refresh={refresh} />
              {isAdmin && !participant.isLocal &&
                (participantHasMedia(participant) || Date.now() - (joinTimesRef.current.get(participant.identity) ?? 0) > PARTICIPANT_REMOVE_GRACE_MS) && (
                <button
                  disabled={moderationBusy === participant.identity}
                  onClick={() => removeParticipant(participant.identity)}
                  className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-red-600 disabled:opacity-50"
                >
                  <UserXIcon className="h-3.5 w-3.5" /> {moderationBusy === participant.identity ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
          {!connected && <p className="py-10 text-center text-sm text-white/60">Connecting to the live class…</p>}
        </div>

        {chatOpen && (
          <>
            {/* Mobile/tablet: bottom sheet, overlaid on top of the video grid */}
            <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Chat">
              <div className="absolute inset-0 bg-black/60" onClick={() => setChatOpen(false)} />
              <div className="absolute inset-x-0 bottom-0 flex max-h-[75vh] flex-col rounded-t-2xl border-t border-white/10 bg-ink-950 p-4 shadow-2xl">
                <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <h2 className="font-semibold">Chat</h2>
                  <button onClick={() => setChatOpen(false)} aria-label="Close chat" className="rounded-full p-1.5 text-white/60 hover:bg-white/10">
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
                {chatMessages}
                {chatComposer}
              </div>
            </div>

            {/* Tablet-landscape/desktop: persistent sidebar */}
            <aside className="hidden w-80 flex-col rounded-2xl border border-white/10 bg-white/5 p-4 md:flex">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Chat</h2><span className="text-xs text-white/40">Live</span></div>
              {chatMessages}
              {chatComposer}
            </aside>
          </>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-white/10 bg-ink-950/95 px-3 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={toggleMic}
            aria-pressed={micOn}
            className={`flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition ${micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-red-600 text-white hover:bg-red-500"}`}
          >
            {micOn ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{micOn ? "Mute" : "Unmute"}</span>
          </button>
          <button
            onClick={toggleCamera}
            aria-pressed={cameraOn}
            className={`flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition ${cameraOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-red-600 text-white hover:bg-red-500"}`}
          >
            {cameraOn ? <VideoIcon className="h-4 w-4" /> : <VideoOffIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{cameraOn ? "Camera off" : "Camera on"}</span>
          </button>
          <button
            onClick={toggleScreen}
            aria-pressed={screenOn}
            className={`flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition ${screenOn ? "bg-amber-500 text-ink-950 hover:bg-amber-400" : "bg-white/10 text-white hover:bg-white/15"}`}
          >
            <MonitorIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{screenOn ? "Stop share" : "Share screen"}</span>
          </button>
          <button onClick={leave} className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500">
            <LogOutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Leave</span>
          </button>
          {isAdmin && <span className="ml-2 hidden rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300 sm:inline">Host</span>}
        </div>
      </footer>
    </div>
  );
}
