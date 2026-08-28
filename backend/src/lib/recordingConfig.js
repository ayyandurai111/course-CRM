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

module.exports = { recordingS3Config, recordingEnabled };
