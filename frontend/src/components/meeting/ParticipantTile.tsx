import { useEffect, useMemo, useRef } from "react";
import { Track, type Participant, type TrackPublication } from "livekit-client";

/**
 * Pick the video that should be visible for this participant.
 * Screen share wins over camera when both are published.
 */
function pickVideoPublication(participant: Participant): TrackPublication | undefined {
  const publications = Array.from(participant.videoTrackPublications.values());
  const screenShare = publications.find(
    (publication) => publication.track && publication.source === Track.Source.ScreenShare
  );
  if (screenShare?.track) return screenShare;

  return publications.find((publication) => !!publication.track);
}

export default function ParticipantTile({
  participant,
  refresh,
}: {
  participant: Participant;
  refresh: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const videoPublication = useMemo(
    () => pickVideoPublication(participant),
    [participant, refresh]
  );
  const videoTrack = videoPublication?.track;

  const audioPublication = useMemo(
    () => Array.from(participant.audioTrackPublications.values()).find((publication) => !!publication.track),
    [participant, refresh]
  );
  const audioTrack = audioPublication?.track;
  const isScreenSharing = videoPublication?.source === Track.Source.ScreenShare;

  // Attach/detach the actual LiveKit tracks to real DOM media elements.
  // The extra play() call is intentional: some browsers create the <video>
  // element first and only allow playback on the next render tick.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (videoTrack) {
      videoTrack.attach(videoElement);
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      void videoElement.play().catch(() => {
        // The track is still attached. Browsers can reject play() until the
        // media element is allowed to play; LiveKit will continue rendering
        // once the browser permits playback.
      });
    }

    return () => {
      if (videoTrack) videoTrack.detach(videoElement);
      videoElement.srcObject = null;
    };
  }, [videoTrack, videoPublication?.trackSid, refresh]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement || !audioTrack) return;

    audioTrack.attach(audioElement);
    audioElement.autoplay = true;
    void audioElement.play().catch(() => undefined);

    return () => {
      audioTrack.detach(audioElement);
      audioElement.srcObject = null;
    };
  }, [audioTrack, audioPublication?.trackSid, refresh]);

  return (
    <div className="relative h-full min-h-[220px] overflow-hidden rounded-2xl bg-black shadow-card">
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className={`block h-full min-h-[220px] w-full ${isScreenSharing ? "object-contain" : "object-cover"}`}
        />
      ) : (
        <div className="flex h-full min-h-[220px] items-center justify-center bg-ink-900 text-white/50">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white">
              {(participant.name || participant.identity || "?").slice(0, 1).toUpperCase()}
            </div>
            <p className="text-sm">Camera is off</p>
          </div>
        </div>
      )}

      <audio ref={audioRef} autoPlay muted={participant.isLocal} />

      {isScreenSharing && (
        <div className="absolute left-3 top-3 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-white">
          Presenting
        </div>
      )}

      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
        {participant.name || participant.identity}{participant.isLocal ? " (You)" : ""}
      </div>
    </div>
  );
}
