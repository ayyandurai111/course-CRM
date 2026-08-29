import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";
import ParticipantTile from "../components/meeting/ParticipantTile";
import { MicIcon, MicOffIcon } from "../components/common/Icons";

/**
 * This page is never opened by a person — it's the URL LiveKit Egress
 * loads in a headless Chrome instance to render a meeting recording
 * (see backend/src/services/meetingRecordingService.js, which sets it
 * as `customBaseUrl` on startRoomCompositeEgress). Whatever renders
 * here IS the recorded video, pixel for pixel, so it deliberately
 * mirrors MeetingRoom's spotlight + filmstrip layout and the
 * icon-only "speaking now" highlight — just with every interactive
 * control (header, chat, footer buttons, moderation) stripped out,
 * since there's no one here to click them.
 *
 * Route is intentionally outside RequireMeeting/RequireRole in
 * App.tsx: Egress authenticates to LiveKit with its own short-lived
 * recorder token (in the `token` query param), not our app's login
 * session, and never calls our backend API at all.
 */
export default function RecordingLayoutPage() {
  const roomRef = useRef<Room | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    let wsUrl = "";
    let token = "";
    try {
      wsUrl = EgressHelper.getLiveKitURL();
      token = EgressHelper.getAccessToken();
    } catch {
      // Missing/invalid query params — nothing to connect to. Leaves the
      // page on a blank dark screen rather than throwing, since this
      // only ever runs inside Egress's own headless Chrome, not for a
      // real visitor who could otherwise be shown an error.
    }
    if (!wsUrl || !token) return;

    // No adaptive/dynacast: this is a single fixed "viewer" watching
    // every track at once for compositing, not a real user's browser
    // trying to save bandwidth.
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    EgressHelper.setRoom(room);

    const rerender = () => active && setRefresh((v) => v + 1);
    room.on(RoomEvent.TrackSubscribed, rerender);
    room.on(RoomEvent.TrackUnsubscribed, rerender);
    room.on(RoomEvent.ParticipantConnected, rerender);
    room.on(RoomEvent.ParticipantDisconnected, rerender);
    room.on(RoomEvent.ActiveSpeakersChanged, rerender);
    room.on(RoomEvent.TrackMuted, rerender);
    room.on(RoomEvent.TrackUnmuted, rerender);

    room
      .connect(wsUrl, token)
      .then(() => {
        if (!active) return;
        setConnected(true);
        rerender();
        // Let two frames actually paint (tiles, names, avatars) before
        // telling Egress to start capturing, so the recording doesn't
        // open on a blank flash of the page background.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (active) EgressHelper.startRecording();
          });
        });
      })
      .catch(() => {
        // Best-effort: if the room can't be joined at all, Egress will
        // simply never see START_RECORDING and the request eventually
        // times out server-side rather than producing a broken file.
      });

    return () => {
      active = false;
      room.disconnect();
      roomRef.current = null;
    };
  }, []);

  // The egress recorder participant (this page) never appears in its
  // own room.remoteParticipants, so no filtering is needed here beyond
  // that — every real participant in the meeting is fair game.
  const participants = useMemo(() => {
    const room = roomRef.current;
    if (!room) return [];
    return Array.from(room.remoteParticipants.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, connected]);

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950 text-white">
      <main className="flex min-h-0 flex-1 gap-3 p-5">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3">
          {spotlightParticipant && (
            <div
              className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-ink-950 shadow-card transition-shadow duration-150 ${
                spotlightParticipant.isSpeaking ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-950" : ""
              }`}
            >
              <ParticipantTile participant={spotlightParticipant} refresh={refresh} />
              {spotlightParticipant.isSpeaking && (
                <span
                  aria-label="Speaking"
                  className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-4 ring-emerald-500/30"
                >
                  <MicIcon className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          )}

          {filmstripParticipants.length > 0 && (
            <div className="flex shrink-0 gap-3 overflow-x-auto pb-1">
              {filmstripParticipants.map((participant) => (
                <div
                  key={participant.identity}
                  className={`relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl bg-ink-950 shadow-card transition-shadow duration-150 ${
                    participant.isSpeaking ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-ink-950" : ""
                  }`}
                >
                  <ParticipantTile participant={participant} refresh={refresh} />
                  {participant.isSpeaking ? (
                    <div
                      aria-label="Speaking"
                      className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow ring-2 ring-emerald-500/30"
                    >
                      <MicIcon className="h-3 w-3" />
                    </div>
                  ) : isMicMuted(participant) && (
                    <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">
                      <MicOffIcon className="h-3 w-3" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
