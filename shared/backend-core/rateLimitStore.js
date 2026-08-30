/**
 * Rate limiting is intentionally process-local for the supported deployment
 * topology (one backend instance). Multi-instance mode must fail closed in
 * src/index.js until a shared store is installed; silently falling back from
 * Redis to MemoryStore is unsafe because it creates a hidden limit bypass.
 */
function createRateLimitStore() {
  if (!process.env.REDIS_URL) return undefined;

  // An operator has opted into shared/multi-instance rate limiting by
  // setting REDIS_URL, but the optional Redis packages this would
  // require (ioredis, rate-limit-redis) are not dependencies of this
  // project. Falling back to a process-local MemoryStore here silently
  // would look like a working shared limiter while actually being a
  // hidden per-process bypass — so we warn loudly and still fail closed
  // to "no shared store" (never throw, since a broken rate limiter must
  // not take down the server).
  try {
    require.resolve("ioredis");
    require.resolve("rate-limit-redis");
  } catch {
    console.error(
      "[rateLimitStore] REDIS_URL is set but the optional \"ioredis\" and \"rate-limit-redis\" packages are not installed. " +
        "Falling back to a process-local rate limit store — this is NOT shared across instances. " +
        "Install those packages and wire a Redis-backed store before running multiple instances."
    );
    return undefined;
  }

  // Packages are present but wiring a real client is not yet
  // implemented; still fail closed rather than pretend to be shared.
  console.error(
    "[rateLimitStore] REDIS_URL is set and Redis packages are installed, but shared-store wiring is not yet implemented. " +
      "Falling back to a process-local rate limit store."
  );
  return undefined;
}

module.exports = { createRateLimitStore };
