// Meeting recording is entirely optional/best-effort: a course CRM must
// keep working (scheduling/starting/ending live meetings) even if the
// operator never configures Egress. Every recording env var is read
// through this module so there is exactly one place that decides
// "is recording possible right now?".
//
// Recording writes the encoded file straight into this project's own
// private Storage bucket over Supabase's S3-compatible endpoint
// (Project Settings -> Storage -> S3 Connection), at the exact path a
// published VIDEO content row would use (see fileValidation.buildStoragePath).
// That means "publish the recording" is just contentService.publishNow() —
// no separate copy/move step, and no new Storage bucket to secure.
function recordingS3Config() {
  const accessKey = process.env.SUPABASE_S3_ACCESS_KEY;
  const secret = process.env.SUPABASE_S3_SECRET_KEY;
  const region = process.env.SUPABASE_S3_REGION;
  const endpoint = process.env.SUPABASE_S3_ENDPOINT;
  const bucket = process.env.SUPABASE_S3_BUCKET || process.env.SUPABASE_STORAGE_BUCKET;
  if (!accessKey || !secret || !region || !endpoint || !bucket) return null;
  return { accessKey, secret, region, endpoint, bucket, forcePathStyle: true };
}

function recordingEnabled() {
  if (process.env.MEETING_RECORDINGS_ENABLED === "false") return false;
  return !!recordingS3Config();
}

// Optional custom recording layout: a URL to the frontend's
// RecordingLayoutPage.tsx, passed to Egress as `customBaseUrl` so the
// recorded FILE shows the same spotlight/filmstrip layout and speaking
// highlight as the live MeetingRoom UI, instead of LiveKit's generic
// built-in "grid" template.
//
// MEETING_RECORDING_TEMPLATE_URL lets an operator point this at
// wherever Egress can actually reach it (useful in dev, where Egress
// runs in its own container and "localhost" would mean the container,
// not the host). In the common single-server Render deployment
// (render.yaml) there's nothing to configure: RENDER_EXTERNAL_URL is
// set automatically and already points at the one public URL that
// serves this same frontend build.
//
// Recording works exactly as before (LiveKit's built-in "grid" layout)
// if neither is set — this is purely additive.
function recordingTemplateBaseUrl() {
  const explicit = process.env.MEETING_RECORDING_TEMPLATE_URL;
  const base = explicit || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/recording-layout` : null);
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

module.exports = { recordingS3Config, recordingEnabled, recordingTemplateBaseUrl };
