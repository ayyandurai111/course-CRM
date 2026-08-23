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
 * ---------------------------------------------------------------------
 * Spec fix — "Prepare Rate Limits for Multiple Servers" — LOCAL vs
 * GLOBAL accounting (requirements #1-3). Every counter below
 * (`activeCount`, `reservedBytes`) lives in this module's plain JS
 * variables: PROCESS-LOCAL state, one independent copy per running
 * instance of this service. That is fine and by design for the current
 * deployment — render.yaml runs exactly ONE web service instance, so
 * "process-local" and "global" are the same thing today. It stops being
 * fine the moment this service is scaled to more than one instance
 * behind a load balancer: each instance would enforce
 * MAX_CONCURRENT_UPLOADS/MAX_TEMP_STORAGE_BYTES independently, so the
 * TRUE aggregate ceiling across the whole deployment becomes
 * (limit × instance count) — an attacker (or just heavy legitimate
 * traffic) spread across instances can exceed the intended limit
 * without any single instance ever seeing a violation.
 *
 * Full accounting of every security-critical in-memory counter in this
 * codebase (see docs/SCALING.md for the long-form version):
 *
 *   | Counter                          | Where              | Scope today | Becomes global via         |
 *   |-----------------------------------|--------------------|-------------|-----------------------------|
 *   | activeCount (upload concurrency)  | this module        | per-process | Redis (INCR/DECR)          |
 *   | reservedBytes (upload temp disk)  | this module        | per-process | Redis (INCRBY/DECRBY)      |
 *   | express-rate-limit counters (x3)  | index.js, upload.routes.js | per-process (unless REDIS_URL set — see lib/rateLimitStore.js) | rate-limit-redis, already wired, opt-in |
 *   | try_reserve_upload_quota (daily $/user quota) | Postgres function, called from upload.routes.js | ALREADY GLOBAL — lives in the shared Supabase Postgres database, not in any Node process, and uses a single atomic UPDATE so it's safe under concurrent callers from any number of instances | n/a, already correct |
 *
 * Design for going multi-instance (requirement #4): the two counters in
 * this module are the ones that would need a shared backing store — the
 * natural choice is Redis, using `INCRBY`/`DECRBY` for reservedBytes and
 * `INCR`/`DECR` for activeCount, each wrapped in a Lua script (or
 * `WATCH`/`MULTI`) so the "would this exceed the cap" check-then-act
 * stays atomic across instances, mirroring the pattern
 * `try_reserve_upload_quota` already uses in Postgres for the
 * database-backed quota (requirement #5 — that one is untouched by this
 * fix; it was already correct). This module intentionally does NOT ship
 * that Redis integration by default (requirement: "do not introduce a
 * new external dependency unless necessary") — this app runs as a
 * single instance today, so doing so now would add real complexity and
 * an operational dependency (a Redis instance to provision, monitor,
 * and fail over) for no current benefit. If/when this service is
 * actually scaled horizontally, swap tryReserveBytes/tryAcquireUploadSlot
 * below for calls into a Redis-backed store, following the same
 * function signatures so callers don't change (requirement #7 — this is
 * exactly what prevents an attacker from bypassing the aggregate limit
 * by hitting different instances, once implemented). Until then, be
 * honest about the limitation rather than claim a protection that isn't
 * there yet (requirement: never overstate what the architecture
 * actually supports) — this is a real, documented gap for a genuinely
 * horizontally-scaled deployment, not a solved problem.
 * ---------------------------------------------------------------------
 *
 * IMPORTANT — byte accounting is metered LIVE, not from Content-Length:
 * an earlier version of this gate reserved `reservedBytes` up front
 * from the request's declared Content-Length header. A client can omit
 * that header entirely by sending `Transfer-Encoding: chunked`, which
 * made the reservation calculate 0 bytes while Multer still streamed
 * an arbitrarily large file to temp disk — silently defeating
 * MAX_TEMP_STORAGE_BYTES for exactly the requests it exists to catch.
 * Content-Length is merely a client-supplied *claim*; it must never be
 * the sole basis for a resource-exhaustion control. Instead, the upload
 * route now calls `tryReserveBytes()` incrementally for every chunk as
 * it is actually written to disk (see upload.routes.js's metered
 * storage engine), so the pool is always accurate regardless of what
 * (if anything) the client declared up front.
 */

const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS) || 5;
const MAX_TEMP_STORAGE_BYTES = Number(process.env.MAX_TEMP_STORAGE_BYTES) || 2 * 1024 * 1024 * 1024; // 2GB

let activeCount = 0;
let reservedBytes = 0;

/**
 * Reserves a concurrency slot for an incoming upload. Byte accounting
 * is intentionally NOT done here — it happens live, chunk-by-chunk, via
 * `tryReserveBytes()` below, since Content-Length cannot be trusted
 * (see module doc comment).
 */
function tryAcquireUploadSlot() {
  if (activeCount >= MAX_CONCURRENT_UPLOADS) {
    return { ok: false, reason: "Too many uploads are in progress. Please try again shortly." };
  }
  activeCount += 1;
  return { ok: true };
}

/** Releases a previously-acquired concurrency slot. Safe to call at most once per acquire; idempotent against underflow. */
function releaseUploadSlot() {
  activeCount = Math.max(0, activeCount - 1);
}

/**
 * Attempts to reserve `bytes` more of the shared temp-disk pool. Called
 * for every chunk actually streamed to disk (live metering), so an
 * upload with no/false Content-Length is bounded exactly the same as
 * one with an honest one. Returns false the instant the shared pool
 * would be exceeded, so the caller can abort *just this* upload without
 * disturbing others already in flight.
 */
function tryReserveBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return true;
  if (reservedBytes + b > MAX_TEMP_STORAGE_BYTES) return false;
  reservedBytes += b;
  return true;
}

/** Releases previously-reserved bytes (e.g. on upload completion, failure, or abort). Idempotent against underflow. */
function releaseBytes(bytes) {
  reservedBytes = Math.max(0, reservedBytes - (Number(bytes) || 0));
}

function getUploadGateStats() {
  return { activeCount, reservedBytes, MAX_CONCURRENT_UPLOADS, MAX_TEMP_STORAGE_BYTES };
}

/** Test-only reset so unit tests don't leak state into each other. */
function _resetForTests() {
  activeCount = 0;
  reservedBytes = 0;
}

module.exports = {
  tryAcquireUploadSlot,
  releaseUploadSlot,
  tryReserveBytes,
  releaseBytes,
  getUploadGateStats,
  _resetForTests,
  MAX_CONCURRENT_UPLOADS,
  MAX_TEMP_STORAGE_BYTES,
};
