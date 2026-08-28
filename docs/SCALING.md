# Scaling notes: process-local state

This app is currently designed to run as a **single instance**. A few
counters live in plain in-process JS state rather than a shared store.
If this is ever horizontally scaled (2+ instances behind a load
balancer), these need to move to a shared backend (Redis is the
natural choice) or they will silently under-enforce their limits.

| State | Where it lives today | Scope today | What it needs to become for multi-instance |
|---|---|---|---|
| `activeCount` (concurrent upload slots, `backend/src/lib/uploadGate.js`) | a module-level JS variable | per-process | Redis `INCR`/`DECR`, atomic |
| `reservedBytes` (reserved temp-disk space, `backend/src/lib/uploadGate.js`) | a module-level JS variable | per-process | Redis `INCRBY`/`DECRBY`, atomic |
| Rate limit buckets (`backend/src/lib/rateLimitStore.js`) | `express-rate-limit`'s in-memory `MemoryStore` | per-process | A shared store (e.g. `rate-limit-redis`) — `createRateLimitStore()` already fails closed with a clear startup error if `REDIS_URL` is set without a real Redis-backed store wired in, instead of silently under-counting. There are four instances today: general `/api`, `/api/auth`, `/api/livekit/webhook` (all in `backend/src/index.js`), and the upload route (`backend/src/routes/upload.routes.js`). |

`try_reserve_upload_quota` (the per-user daily upload $ quota) is
**already correct for multi-instance** today — it's a Postgres function
in `supabase/schema.sql` that does a single atomic `UPDATE`, so it's
safe under concurrent callers from any number of app instances. It's
listed here only for contrast with the two counters above.

As long as this deployment stays single-instance, "process-local" and
"global" are the same thing, so no action is required. This file exists
so that the day someone scales this out, the two counters above aren't
missed.
