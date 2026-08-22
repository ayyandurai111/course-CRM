/**
 * Process-local concurrency + temp-disk-usage gate for large uploads
 * (spec #3C/#3G). Rate limiting alone (express-rate-limit) caps request
 * *frequency*, not how much memory/disk multiple uploads can hold open
 * at once — a handful of legitimate concurrent 500MB video uploads can
 * still exhaust temp disk or overwhelm the instance. This module adds
 * two more independent controls on top of the rate limiter:
 *
 *   - MAX_CONCURRENT_UPLOADS: hard cap on simultaneous large uploads.
 *   - MAX_TEMP_STORAGE_BYTES: hard cap on bytes reserved for uploads
 *     currently being written to the OS temp dir / streamed to Storage.
 *
 * This is per-process state (fine for a single Render instance; if the
 * service ever scales horizontally, the real ceiling becomes each
 * instance's own limit, which is still a meaningful bound per box).
 */

const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS) || 5;
const MAX_TEMP_STORAGE_BYTES = Number(process.env.MAX_TEMP_STORAGE_BYTES) || 2 * 1024 * 1024 * 1024; // 2GB

let activeCount = 0;
let reservedBytes = 0;

/**
 * Attempts to reserve a slot for an incoming upload. `estimatedBytes`
 * should be the request's declared Content-Length (an upper bound on
 * the file size, known before multer even starts writing to disk).
 */
function tryAcquireUploadSlot(estimatedBytes) {
  const bytes = Number.isFinite(estimatedBytes) && estimatedBytes > 0 ? estimatedBytes : 0;

  if (activeCount >= MAX_CONCURRENT_UPLOADS) {
    return { ok: false, reason: "Too many uploads are in progress. Please try again shortly." };
  }
  if (reservedBytes + bytes > MAX_TEMP_STORAGE_BYTES) {
    return { ok: false, reason: "Server temporary storage is at capacity. Please try again shortly." };
  }

  activeCount += 1;
  reservedBytes += bytes;
  return { ok: true, bytes };
}

/** Releases a previously-acquired slot. Safe to call at most once per acquire; idempotent against underflow. */
function releaseUploadSlot(bytes) {
  activeCount = Math.max(0, activeCount - 1);
  reservedBytes = Math.max(0, reservedBytes - (Number(bytes) || 0));
}

function getUploadGateStats() {
  return { activeCount, reservedBytes, MAX_CONCURRENT_UPLOADS, MAX_TEMP_STORAGE_BYTES };
}

module.exports = {
  tryAcquireUploadSlot,
  releaseUploadSlot,
  getUploadGateStats,
  MAX_CONCURRENT_UPLOADS,
  MAX_TEMP_STORAGE_BYTES,
};
