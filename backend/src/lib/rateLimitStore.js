/**
 * Spec fix — "Prepare Rate Limits for Multiple Servers".
 *
 * Every `express-rate-limit` instance in this app (see index.js and
 * upload.routes.js) defaults to an in-memory counter store scoped to
 * the single Node process it runs in. That is correct and sufficient
 * for the current deployment (render.yaml runs exactly ONE web service
 * instance — see that file's header comment), but it does NOT hold up
 * the moment the service is scaled horizontally to more than one
 * instance: each instance would track its own independent count, so a
 * client could get up to (limit × instance count) requests through by
 * simply being routed to different instances (e.g. behind a
 * load balancer), silently multiplying every configured limit.
 *
 * This module is the single place that decides, per rate limiter,
 * whether to use the default per-process store or a shared one:
 *
 *   - No REDIS_URL configured (the current, single-instance default):
 *     returns `undefined`, so express-rate-limit falls back to its own
 *     built-in in-memory MemoryStore exactly as before. No behavior
 *     change, no new dependency required to run this app as-is.
 *
 *   - REDIS_URL configured (operator has opted into horizontal
 *     scaling): attempts to build a Redis-backed store using the
 *     `rate-limit-redis` + `ioredis` packages, loaded via a guarded
 *     `require()` so neither is a hard dependency of this project (per
 *     the "do not introduce a new external dependency unless
 *     necessary" constraint) — an operator who wants multi-instance
 *     rate limiting installs them (`npm install ioredis rate-limit-redis`)
 *     alongside setting REDIS_URL. If REDIS_URL is set but those
 *     packages aren't installed, this logs a loud, explicit startup
 *     warning and falls back to the per-instance store rather than
 *     silently pretending the limit is now global — see
 *     docs/SCALING.md for the full accounting of what is/isn't shared
 *     today, and why (spec requirement: never claim a protection is
 *     stronger than it actually is).
 */
function createRateLimitStore(namespace) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return undefined; // express-rate-limit's own per-process MemoryStore

  try {
    // eslint-disable-next-line global-require
    const RedisStore = require("rate-limit-redis").default || require("rate-limit-redis");
    // eslint-disable-next-line global-require
    const Redis = require("ioredis");
    const client = new Redis(redisUrl);
    client.on("error", (err) => console.error(`[rateLimitStore:${namespace}] Redis connection error:`, err.message));
    return new RedisStore({
      prefix: `rl:${namespace}:`,
      sendCommand: (...args) => client.call(...args),
    });
  } catch (err) {
    console.error(
      `[rateLimitStore:${namespace}] REDIS_URL is set, requesting shared multi-instance rate limiting, but the ` +
        `optional "ioredis"/"rate-limit-redis" packages are not installed (${err.message}). ` +
        "Falling back to a PER-INSTANCE in-memory store — rate limits will NOT be shared across instances " +
        "until both packages are installed. See docs/SCALING.md."
    );
    return undefined;
  }
}

module.exports = { createRateLimitStore };
