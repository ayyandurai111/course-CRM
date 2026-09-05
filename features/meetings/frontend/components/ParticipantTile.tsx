import { useEffect, useRef, useState } from "react";
import { Track, type Participant } from "livekit-client";
import { HandIcon } from "../../../../shared/frontend-core/components/common/Icons";

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

/** Safely reads the profile photo URL carried in the LiveKit token's
 * metadata (see backend/src/routes/meetings.routes.js) so a tile can
 * show a real profile picture instead of bare initials when someone's
 * camera is off — the way Google Meet does it. Metadata is
 * participant-supplied-at-connect-time JSON, so this never trusts it
 * beyond reading a URL string back out; the URL itself was already
 * validated server-side before it was ever saved to the user's profile. */
function getAvatarUrl(participant: Participant): string | null {
  try {
    const meta = JSON.parse(participant.metadata || "{}");
    return typeof meta.avatarUrl === "string" ? meta.avatarUrl : null;
  } catch {
    return null;
  }
}

/** Same metadata JSON carries which role issued the LiveKit token (see
 * backend/src/routes/meetings.routes.js), so any client can tell which
 * participant is the Teacher — not just "am I the admin looking at my
 * own tile", which is all `isLocal`/`isAdmin` alone can tell you. Used
 * by MeetingRoom to label the Teacher's tile and to know who to fall
 * back to as the main/spotlight tile. */
export function getParticipantRole(participant: Participant): "ADMIN" | "STUDENT" | null {
  try {
    const meta = JSON.parse(participant.metadata || "{}");
    return meta.role === "ADMIN" ? "ADMIN" : meta.role === "STUDENT" ? "STUDENT" : null;
  } catch {
    return null;
  }
}

export default function ParticipantTile({
  participant,
  refresh,
  handRaised = false,
}: {
  participant: Participant;
  refresh: number;
  /** Whether this participant currently has their hand raised — see the
   * "hand" data-channel messages in MeetingRoom, which is the source of
   * truth this gets passed down from. Purely a display flag here. */
  handRaised?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const isScreenSharing = Array.from(participant.videoTrackPublications.values()).some(
    (p) => !!p.track && p.track.source === Track.Source.ScreenShare
  );
  const videoPubs = Array.from(participant.videoTrackPublications.values());
  // Real fix, confirmed via the debug overlay: LiveKit keeps a video
  // publication around (with a live-looking `.track` reference) even
  // after the camera is turned off — it marks it `isMuted` and the
  // underlying MediaStreamTrack's `readyState` becomes "ended", rather
  // than removing the publication outright. This is deliberate on
  // LiveKit's side (it makes turning the camera back on instant, no
  // renegotiation) but it means "does a track object exist" is not the
  // same question as "is there actually video to show". The old check
  // only asked the first question, so a camera that had been turned off
  // still counted as `hasVideo = true`, leaving a blank/dead <video>
  // element on screen instead of the profile-photo/initials fallback.
  const hasVideo = videoPubs.some(
    (p) => !!p.track && !p.isMuted && p.track.mediaStreamTrack?.readyState !== "ended",
  );

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
  const avatarUrl = getAvatarUrl(participant);

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
        // who never turns their camera on. Google Meet–style: a plain
        // circular avatar (real photo, or initials if none/broken) with
        // a soft ring around it, no caption text underneath.
        //
        // This same tile renders at very different sizes depending on
        // where MeetingRoom places it — the large flex-1 spotlight tile,
        // the sm:w-40 filmstrip thumbnails, and the narrow 2-column
        // mobile grid. A fixed pixel size for the circle looked right
        // in the spotlight but badly overflowed the small thumbnails, so
        // the circle's size (and its text) is a percentage of whichever
        // box it's actually in, clamped so it never gets absurdly tiny
        // or huge at the extremes.
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900">
          {avatarUrl && !avatarFailed ? (
            <img
              src={avatarUrl}
              alt=""
              onError={() => setAvatarFailed(true)}
              style={{ width: "clamp(2.5rem, 32%, 7rem)", height: "clamp(2.5rem, 32%, 7rem)" }}
              className="rounded-full object-cover ring-4 ring-white/15"
            />
          ) : (
            <div
              style={{ width: "clamp(2.5rem, 32%, 7rem)", height: "clamp(2.5rem, 32%, 7rem)", fontSize: "clamp(0.75rem, 10%, 1.5rem)" }}
              className="flex items-center justify-center rounded-full bg-white/10 font-semibold text-white/70 ring-4 ring-white/15"
            >
              {initials(displayName)}
            </div>
          )}
        </div>
      )}
      {/* Bug fix, round 2: CSS `hidden` (display:none) stops the stale
          frame from showing in a normal foreground browser tab, but it
          turned out not to be enough inside LiveKit Egress's headless
          Chrome recorder (RecordingLayoutPage) — once a camera stream
          had actually decoded and painted a frame into this <video>,
          toggling it to `display:none` still left that decoded frame
          sitting in the compositor's layer cache in some headless
          runs, with nothing forcing an invalidation the way real user
          interaction/vsync churn does in a normal tab. Recordings kept
          showing the last frame (or plain black) over the profile
          picture even though the exact same toggle worked live.
          The reliable fix is to not just hide the element but remove
          it from the tree entirely when there's no video: an unmounted
          <video> has no layer to leave stale content in, full stop.
          React remounts a fresh one (empty srcObject) the moment
          `hasVideo` flips back to true, and the attach effect below
          re-attaches into it via the ref as usual. */}
      {hasVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className={`absolute inset-0 h-full w-full ${isScreenSharing ? "object-contain" : "object-cover"}`}
        />
      )}
      <audio ref={audioRef} autoPlay muted={participant.isLocal} />
      {isScreenSharing && <div className="absolute left-3 top-3 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-white">Presenting</div>}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
        {handRaised && <HandIcon aria-label="Hand raised" className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        {displayName}{participant.isLocal ? " (You)" : ""}
      </div>
    </>
  );
}
