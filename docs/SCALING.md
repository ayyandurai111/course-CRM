# Running this service on more than one instance

**Current deployment (render.yaml): exactly ONE web service instance.**
Everything in this document describes what changes — and what does
NOT automatically change — if that is ever scaled up to multiple
instances behind a load balancer.

## Every security-critical in-memory counter

| Counter | Module | What it protects | Scope today | Global? |
|---|---|---|---|---|
| `activeCount` | `src/lib/uploadGate.js` | Max simultaneous large uploads (`MAX_CONCURRENT_UPLOADS`) | **Process-local** | No |
| `reservedBytes` | `src/lib/uploadGate.js` | Max temp-disk bytes in flight across all uploads (`MAX_TEMP_STORAGE_BYTES`) | **Process-local** | No |
| `/api` rate limiter | `src/index.js` | General API abuse throttling (300 req / 15 min) | Process-local, unless `REDIS_URL` + optional Redis packages configured | Opt-in |
| `/api/auth` rate limiter | `src/index.js` | Login/auth abuse throttling (30 req / 15 min) | Process-local, unless `REDIS_URL` + optional Redis packages configured | Opt-in |
| Upload rate limiter | `src/routes/upload.routes.js` | Per-window upload request throttling (60 req / 15 min) | Process-local, unless `REDIS_URL` + optional Redis packages configured | Opt-in |
| `try_reserve_upload_quota` / `release_upload_quota` | Postgres functions in `supabase/schema.sql` | Per-user daily upload byte quota (`MAX_USER_UPLOAD_BYTES_PER_DAY`) | **Database (Supabase Postgres)** | Already global |

## Why this matters

Every "process-local" row above is a plain JS variable (or
`express-rate-limit`'s default `MemoryStore`) that exists once per
running Node process. If this service runs as two instances behind a
load balancer, each instance enforces its own copy of these limits
independently. A client whose requests get spread across both
instances effectively gets up to `limit x instance count` through —
the load balancer doesn't know or care that "you've already used your
quota on the other box." This is a real limit-bypass, not a
theoretical one, and requirement #7 of this fix (prevent an attacker
from bypassing global limits by hitting different servers) is only
actually satisfied for the rows above marked "Already global" or a
correctly configured "Opt-in".

The database-backed daily upload quota is the one exception that was
already correct: it lives in Supabase Postgres — a single shared
database regardless of how many API instances call into it — and uses
one atomic `UPDATE ... SET used = used + $1 WHERE used + $1 <= limit`
statement (see `try_reserve_upload_quota` in `supabase/schema.sql`), so
concurrent callers from any number of instances can never both read a
stale "under quota" value and both proceed. Nothing about this fix
needed to change there; it's included in the table for completeness,
per requirement #1 ("identify every security-critical in-memory
counter" — this row is explicitly *not* one, and that's worth stating
plainly).

## What's already wired up: rate limiters

All three `express-rate-limit` instances now go through
`src/lib/rateLimitStore.js`, which:

- Returns `undefined` (falls back to express-rate-limit's own in-memory
  store) when `REDIS_URL` isn't set. This is the default and current
  behavior — nothing changes for the current single-instance
  deployment.
- If `REDIS_URL` is set, attempts to build a `rate-limit-redis` store
  backed by `ioredis`. Neither package is a hard dependency of this
  project (per the "don't add a dependency unless necessary"
  constraint) — install them yourself if you're actually scaling out:
  ```bash
  npm install ioredis rate-limit-redis --prefix backend
  ```
- If `REDIS_URL` is set but those packages aren't installed, logs a
  loud, explicit warning and falls back to the per-instance store
  rather than silently pretending the limit is now shared.

## What's NOT wired up yet: upload concurrency + temp-disk bytes

`lib/uploadGate.js`'s two counters (`activeCount`, `reservedBytes`) do
not yet have a Redis-backed alternative. This is a genuine, documented
gap for a horizontally-scaled deployment — not something this fix
silently claims to have solved. If/when this service is actually
scaled to multiple instances:

1. Provision Redis and set `REDIS_URL` (this alone already gets you
   shared rate limiting once the optional packages above are
   installed — see previous section).
2. Replace `activeCount`/`reservedBytes` in `lib/uploadGate.js` with
   calls into a Redis-backed store using the same function signatures
   (`tryAcquireUploadSlot()`, `releaseUploadSlot()`,
   `tryReserveBytes(bytes)`, `releaseBytes(bytes)`) so no caller needs
   to change. The natural implementation: `INCR`/`DECR` for
   `activeCount`, `INCRBY`/`DECRBY` for `reservedBytes`, each guarded
   by a small Lua script (or `WATCH`/`MULTI`) so the "would this exceed
   the cap" check-then-increment stays atomic across instances — the
   exact same pattern `try_reserve_upload_quota` already uses in
   Postgres for the database-backed quota.
3. At that point, the app will log a startup warning (see `index.js`)
   reminding you this step hasn't been done if `REDIS_URL` is set
   without it — treat that warning as a blocker for a real
   multi-instance rollout, not noise to ignore.

Until step 2 is actually implemented, running multiple instances means
`MAX_CONCURRENT_UPLOADS` and `MAX_TEMP_STORAGE_BYTES` are each enforced
per instance, not globally — e.g. with two instances, the true
aggregate ceiling on concurrent uploads is `2 x MAX_CONCURRENT_UPLOADS`.
This is a real, current limitation of this codebase, stated plainly
rather than glossed over.
