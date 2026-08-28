import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import ParticipantTile from "./ParticipantTile";
import { apiRequest, ApiError } from "../../lib/apiClient";

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

export default function MeetingRoom({ token, wsUrl, meeting, onLeave, isAdmin }: {
  token: string;
  wsUrl: string;
  meeting: MeetingInfo;
  onLeave: () => void;
  isAdmin: boolean;
}) {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
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
    const onData = (payload: Uint8Array, participant: any, _kind?: unknown, topic?: string) => {
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
    room.on(RoomEvent.ParticipantConnected, rerender);
    room.on(RoomEvent.ParticipantDisconnected, rerender);
    room.on(RoomEvent.LocalTrackPublished, rerender);
    room.on(RoomEvent.LocalTrackUnpublished, rerender);
    room.on(RoomEvent.TrackMuted, rerender);
    room.on(RoomEvent.TrackUnmuted, rerender);
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Disconnected, () => active && setConnected(false));

    room.connect(wsUrl, token)
      .then(async () => {
        if (!active) return;
        setConnected(true);
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
          await room.localParticipant.setMicrophoneEnabled(true);
          if (active) setMicOn(true);
        } catch (err) {
          console.warn("Could not enable microphone:", err);
        }
        try {
          await room.localParticipant.setCameraEnabled(true);
          if (active) setCameraOn(true);
        } catch (err) {
          console.warn("Could not enable camera:", err);
        }
        rerender();
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Could not join the meeting."));

    return () => {
      active = false;
      room.disconnect();
      roomRef.current = null;
    };
  }, [token, wsUrl]);

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
        <div className="flex items-center gap-2"><span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300">LIVE</span><button onClick={() => setChatOpen((v) => !v)} className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold">💬 Chat</button><span className="hidden rounded-full bg-white/10 px-3 py-2 text-xs sm:inline">👥 {participants.length}</span></div>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3 sm:p-5">
        <div className={`mx-auto grid h-fit max-w-7xl flex-1 gap-3 ${participants.length === 1 ? "lg:grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
          {participants.map((participant) => <div key={participant.identity} className="relative">
            <ParticipantTile participant={participant} refresh={refresh} />
            {isAdmin && !participant.isLocal && <button disabled={moderationBusy === participant.identity} onClick={() => removeParticipant(participant.identity)} className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">{moderationBusy === participant.identity ? "Removing…" : "Remove"}</button>}
          </div>)}
          {!connected && <p className="col-span-full py-10 text-center text-sm text-white/60">Connecting to the live class…</p>}
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
                    ✕
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
          <button onClick={toggleMic} className={`rounded-full px-4 py-3 text-sm font-semibold ${micOn ? "bg-white/10" : "bg-red-500"}`}>🎤 {micOn ? "Mute" : "Unmute"}</button>
          <button onClick={toggleCamera} className={`rounded-full px-4 py-3 text-sm font-semibold ${cameraOn ? "bg-white/10" : "bg-red-500"}`}>📹 {cameraOn ? "Camera off" : "Camera on"}</button>
          <button onClick={toggleScreen} className={`rounded-full px-4 py-3 text-sm font-semibold ${screenOn ? "bg-white text-ink-950" : "bg-white/10"}`}>🖥 {screenOn ? "Stop share" : "Share screen"}</button>
          <button onClick={leave} className="rounded-full bg-red-600 px-4 py-3 text-sm font-semibold text-white">🚪 Leave</button>
          {isAdmin && <span className="ml-2 hidden text-xs text-white/40 sm:inline">Host</span>}
        </div>
      </footer>
    </div>
  );
}
