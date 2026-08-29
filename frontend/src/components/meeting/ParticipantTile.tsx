import { useEffect, useRef } from "react";
import { Track, type Participant } from "livekit-client";

// Bug fix: a participant can have BOTH a camera track and a screen-share
// track published at once (source: Track.Source.Camera vs. ScreenShare),
// both living in the same videoTrackPublications map. The old code did
// `.find((p) => !!p.track)`, which just grabs whichever video track
// happens to be first in the Map's insertion order — for anyone who
// enabled their camera before clicking "Share screen" (the normal
// flow), that's always the camera, so every other participant's "Share
// screen" click had no visible effect at all: clicking it flips
// `screenOn` in the sharer's own UI, but nobody else ever sees the
// shared screen, only the sharer's still-showing webcam. Screen share
// is the whole point of a live class walkthrough, so this silently
// broke a core, recently-added feature.
//
// Fixed by explicitly preferring a Track.Source.ScreenShare publication
// over a Camera one when both exist, since sharing a screen is always
// the more relevant thing to show at that moment.
function pickVideoTrack(participant: Participant) {
  const publications = Array.from(participant.videoTrackPublications.values()).filter((p) => !!p.track);
  const screenShare = publications.find((p) => p.track?.source === Track.Source.ScreenShare);
  return screenShare?.track || publications[0]?.track;
}

/**
 * Whether this participant has anything actually playable yet (video
 * or audio track subscribed). Right when someone joins, they exist in
 * the room's participant list — and used to immediately get a tile
 * with a "Remove" button on it — a beat or two before their camera/mic
 * track has actually been subscribed and rendered. That made it look
 * like you could remove someone before you'd even seen who joined.
 * MeetingRoom uses this to hold the moderation control back until
 * there's a real tile to moderate, not an empty one.
 */
export function participantHasMedia(participant: Participant): boolean {
  return (
    Array.from(participant.videoTrackPublications.values()).some((p) => !!p.track) ||
    Array.from(participant.audioTrackPublications.values()).some((p) => !!p.track)
  );
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export default function ParticipantTile({ participant, refresh }: { participant: Participant; refresh: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isScreenSharing = Array.from(participant.videoTrackPublications.values()).some(
    (p) => !!p.track && p.track.source === Track.Source.ScreenShare
  );
  const hasVideo = Array.from(participant.videoTrackPublications.values()).some((p) => !!p.track);

  useEffect(() => {
    const audioPublication = Array.from(participant.audioTrackPublications.values()).find((p) => !!p.track);
    const video = pickVideoTrack(participant);
    const audio = audioPublication?.track;
    if (video && videoRef.current) video.attach(videoRef.current);
    if (audio && audioRef.current) audio.attach(audioRef.current);
    return () => {
      if (video && videoRef.current) video.detach(videoRef.current);
      if (audio && audioRef.current) audio.detach(audioRef.current);
    };
  }, [participant, refresh]);

  const displayName = participant.name || participant.identity;

  // Renders into the parent tile's `relative` box (sized by MeetingRoom via
  // aspect-video or flex-1), so the video can be absolutely positioned to
  // fill it exactly — no more relying on h-full/min-h-[180px] on the video
  // itself, which had no real height to inherit and caused the extreme
  // zoomed-crop bug.
  return (
    <>
      {!hasVideo && (
        // Shown the moment someone joins, before their camera track (if
        // any) has actually been subscribed — and permanently for anyone
        // who never turns their camera on. Without this the tile was
        // just a blank black box, which read as broken rather than
        // "audio-only" or "still connecting".
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white/70">
            {initials(displayName)}
          </div>
          <p className="text-xs text-white/40">{participantHasMedia(participant) ? "Camera off" : "Joining…"}</p>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        className={`absolute inset-0 h-full w-full ${isScreenSharing ? "object-contain" : "object-cover"}`}
      />
      <audio ref={audioRef} autoPlay muted={participant.isLocal} />
      {isScreenSharing && <div className="absolute left-3 top-3 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-white">Presenting</div>}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
        {displayName}{participant.isLocal ? " (You)" : ""}
      </div>
    </>
  );
}
