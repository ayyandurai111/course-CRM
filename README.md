# Coursewell — Course Content CRM

Full-stack starter: **React (Vite + TS + Tailwind)** frontend, **Node/Express**
backend, **Supabase Auth** (Google OAuth) and **Supabase Postgres** as the
database, with **Supabase Storage** for private course files. No mock data
anywhere — every screen reads from a real Supabase project you control.

> This app was migrated from Firebase (Auth + Firestore + Storage) to
> Supabase (Auth + Postgres + Storage). The architecture and every
> business rule are unchanged; only the underlying platform is different.

## Test accounts

For manual testing without assigning a plan from the Admin panel, this project includes optional test-account seeders. Each creates a Supabase Auth account, creates/updates a `[TEST] All Access` plan containing every current course, and assigns that plan with lifetime access. Google login is completely separate from this and is not affected by any of it.

There are **two independent test accounts** you can enable, each with its own credentials, so they don't collide:

**Test account** (existing — used here as the admin-side login):
1. Set `TEST_ACCOUNT_EMAIL`, `TEST_ACCOUNT_PASSWORD`, and optionally `TEST_ACCOUNT_NAME` in `backend/.env`.
2. Run `npm run seed:test --workspace backend`.
3. Put the same email/password in `frontend/.env` as `VITE_TEST_ACCOUNT_EMAIL` / `VITE_TEST_ACCOUNT_PASSWORD`.
4. Set `VITE_ENABLE_TEST_ACCOUNT=true` and rebuild the frontend.
5. The Login page will show **Continue with Test Account**.

**Test student account** (new — a second, separate account, always STUDENT role):
1. Set `TEST_STUDENT_ACCOUNT_EMAIL`, `TEST_STUDENT_ACCOUNT_PASSWORD`, and optionally `TEST_STUDENT_ACCOUNT_NAME` in `backend/.env`.
2. Run `npm run seed:test:student --workspace backend`.
3. Put the same email/password in `frontend/.env` as `VITE_TEST_STUDENT_ACCOUNT_EMAIL` / `VITE_TEST_STUDENT_ACCOUNT_PASSWORD`.
4. Set `VITE_ENABLE_TEST_STUDENT_ACCOUNT=true` and rebuild the frontend.
5. The Login page will additionally show **Continue with Test Student Account**.

Both seed scripts hardcode `role: "STUDENT"` on every run, so even if `SEED_ADMIN_EMAIL` were ever misconfigured to match one of these emails, re-running the seed script forces it back to STUDENT.

Credentials are public to the browser when a test button is enabled, so use these only for non-sensitive test/demo content. Re-run the relevant seed command after adding courses so its test plan includes them.


## Architecture

```
course-crm/
  backend/     Express API. Verifies Supabase access tokens, all data in Postgres.
  frontend/    React app. Supabase client SDK handles sign-in; everything
               else talks to the backend API.
  supabase/    schema.sql — run this once against your Supabase project.
```

**Why a backend at all, if Supabase can do both auth and DB from the
client?** Access control (which students can see which content, based on
their plan) has to be enforced somewhere the client can't tamper with.
This backend uses the **Supabase service role key**, which bypasses Row
Level Security entirely — so all real authorization logic lives in one
place (`backend/src/services/accessService.js`) instead of being
duplicated into RLS policies. The frontend never talks to Postgres or
Storage directly; it only ever calls this backend's `/api/*` routes
(plus Supabase Auth itself, for sign-in).

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a
   region and set a database password (you won't need it day-to-day —
   the app uses API keys, not a direct Postgres connection string).
2. **Authentication → Providers → Google.** Enable it and fill in your
   Google OAuth client ID/secret (Google Cloud Console →
   Credentials → OAuth 2.0 Client ID → Web application). Add
   `http://localhost:5173` and your production URL under **Authorized
   redirect URIs** in both Google Cloud Console and the Supabase provider
   settings — Supabase shows you the exact callback URL to use.
3. **SQL Editor → New query.** Paste in the contents of
   `supabase/schema.sql` from this repo and run it. This creates every
   table, the RLS policies (deny-all — see the file for why that's
   correct here), and two Postgres functions the backend calls via RPC.
4. **Storage → New bucket.** Name it `course-files`, and leave **Public
   bucket** OFF. (Or uncomment the `insert into storage.buckets` line at
   the bottom of `supabase/schema.sql` before running it, instead.)
5. **Project Settings → API.** Copy:
   - **Project URL** → `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend)
   - **anon public key** → `VITE_SUPABASE_ANON_KEY` (frontend only)
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (backend only — never
     expose this to the frontend or commit it to version control)

## Running as a single server (one URL)

By default (`npm run dev` in each folder) frontend and backend run on
separate ports for a nicer dev loop (hot reload, etc). For a single
process serving everything on **one URL/port**, the backend can serve
the frontend's built static files directly:

```bash
npm run install:all   # from the repo root — installs both backend/ and frontend/
npm start              # from the repo root — builds the frontend, then starts the backend
```

Open `http://localhost:4000` (or whatever `PORT` you set in
`backend/.env`) — the React app, and the `/api/*` routes, are both
served from that one origin. `CORS_ORIGIN` isn't needed in this mode
since the browser only ever calls same-origin.

Under the hood: `npm start` at the root runs `frontend`'s `npm run
build` (outputs static files to `frontend/dist`), then starts the
backend, which serves `frontend/dist` via `express.static` and falls
back to `frontend/dist/index.html` for any non-`/api` route so React
Router's client-side routes (`/admin`, `/dashboard`, etc.) still work on
a hard refresh or direct link.

If you change frontend code, re-run `npm start` (or `npm run build`) to
pick up the change — the backend doesn't rebuild the frontend on its
own.

You still need both `backend/.env` and `frontend/.env` filled in first
(see steps 2–3 below) — `frontend/.env`'s `VITE_SUPABASE_*` values are
baked into the build at build time.

## 2. Backend setup

```bash
cd backend
cp .env.example .env      # fill in Supabase URL + service role key
npm install
npm run dev                # http://localhost:4000
```

## 3. Frontend setup

```bash
cd frontend
cp .env.example .env      # fill in Supabase URL + anon key
npm install
npm run dev                # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000` (see
`vite.config.ts`), so no CORS setup is needed locally.

**Note on Google sign-in during local dev:** Supabase's OAuth flow is a
full-page redirect (there's no popup, unlike the old Firebase flow), so
after Google hands control back to Supabase, you'll be redirected to
`http://localhost:5173/login`, where the app detects the new session and
sends you on to `/admin` or `/dashboard`.

## 4. Create your admin account

There's no seeded fake admin/password — you use real Supabase Auth:

1. Start both servers, open the frontend, and **sign in with Google**.
   This creates a `STUDENT` profile row using your Google account's
   name/email/photo.
2. Promote yourself to admin:
   ```bash
   cd backend
   node scripts/promoteAdmin.js you@example.com
   ```
3. Log out and back in — you'll land on `/admin` instead of `/dashboard`.

From there, everything (courses, content, plans, students) is created
through the Admin Panel — nothing is pre-populated.

### Promoting/demoting admins after bootstrap

Once at least one admin exists, further role changes go through a
privileged endpoint rather than the `promoteAdmin.js` script:

```
POST /api/admin/users/:id/role
Authorization: Bearer <admin's supabase access token>
{ "role": "ADMIN" }   // or "STUDENT" to demote
```

The actor is always identified from the authenticated Supabase JWT,
never from the request body. Business rules (enforced in
`change_user_role()` in `supabase/schema.sql`, not just in Express):

- An admin can never change their own role (no self-promotion or
  accidental self-demotion).
- The final active admin can never be demoted — the request is
  rejected with `403` instead of leaving the app with zero admins.
- Only `STUDENT`/`ADMIN` are accepted; anything else is `422`.

`GET /api/admin/users?search=` lists/searches all users (students and
admins) so you can find the id of whoever you're promoting or
demoting.

## Deploying to Render

This repo includes `render.yaml` (a [Render
Blueprint](https://render.com/docs/blueprint-spec)) that deploys the
whole app as **one web service** in single-server mode — Render builds
the frontend and the backend serves it, so you get one URL.

1. Push this repo to GitHub/GitLab.
2. Complete the Supabase setup in section 1 above first (schema, Google
   provider, `course-files` bucket) — you'll need the four values below
   before deploying.
3. In the Render dashboard: **New → Blueprint**, connect the repo.
   Render reads `render.yaml` and creates the service.
4. Render will prompt for the env vars marked as secrets in
   `render.yaml` — fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_SUPABASE_URL` (same value as `SUPABASE_URL`)
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Render runs `npm run install:all && npm run build`, then
   starts the server with `npm start --prefix backend`. Health checks
   hit `/api/health`.
6. Once live, add the Render URL (`https://<your-service>.onrender.com`)
   to **Supabase → Authentication → URL Configuration → Redirect URLs**,
   and to your Google OAuth client's **Authorized redirect URIs** —
   otherwise Google sign-in will fail with a redirect mismatch after
   deploy.
7. Promote yourself to admin the same way as local dev (step 4 above),
   just run `node scripts/promoteAdmin.js you@example.com` from your own
   machine with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in your shell
   env (pointed at the same Supabase project) — Render's free/starter
   plans don't give you an interactive shell to run it remotely.

**Important — free plan cold starts:** Render's free tier spins the
service down after 15 minutes of inactivity. The `publishScheduler.js`
cron job (auto-publishing SCHEDULED content) only runs while the
process is alive, so scheduled publishing can be delayed until the next
request wakes the service up. Use a paid plan (`plan: starter` or
above in `render.yaml`) if reliable scheduled publishing matters.

**Env vars not in `render.yaml`:** `CORS_ORIGIN` is intentionally
omitted — single-server mode only ever gets same-origin requests. Only
add it if you later split the frontend out to a separate static host
(e.g. Vercel/Netlify) instead of serving it from this same service.



The Admin Panel has a **Site content** tab (`/admin`) that edits the
hero copy, feature tiles, FAQ, plans/course-section headings, footer
tagline, and Terms/Privacy text — all stored in a single Postgres row
(`site_content` table, `id = 'landing'`, jsonb `content` column) and
served publicly via `GET /api/site-content`. Until an admin saves
changes there, the landing page renders sensible bundled defaults
(`frontend/src/lib/defaultSiteContent.ts`), so the site never looks
broken or empty before first setup.

Course cards and pricing plans themselves are **not** edited here — those
come from the real Courses/Plans data, exactly as before.

### Course start dates / Upcoming Courses

Courses now support an optional `start_at` timestamp. Admins can set this in the course editor. Published courses with a future start time appear in the authenticated student dashboard under **Upcoming Courses**, but only when the student has an active, non-expired subscription whose plan includes that course. Scheduled lessons remain separate under **Upcoming Lessons**.

For an existing Supabase database, apply `supabase/migrations/20260823_add_course_start_at.sql` before deploying the frontend/backend changes.

## Data model (Postgres tables — see `supabase/schema.sql`)

- `users` — `{ email, name, role: STUDENT|ADMIN, avatar_url, is_active, created_at }`, `id` = Supabase Auth user id (uuid)
- `courses` — `{ title, slug, description, category, thumbnail_url, is_published }`
- `content` — `{ title, type: VIDEO|PDF|POST, status: DRAFT|SCHEDULED|PUBLISHED|UNPUBLISHED|ARCHIVED, course_id, file_key, scheduled_at, published_at, ... }`
- `plans` — `{ name, price_cents, billing_period, features[], course_ids uuid[], is_active }`
- `subscriptions` — `{ user_id, plan_id, status: ACTIVE|CANCELLED|EXPIRED, expires_at }`
- `content_progress` — `id` = `{userId}_{contentId}` — `{ progress_percent, viewed, last_position_seconds }`
- `audit_logs` — every admin action, for accountability
- `site_content` — single row (`id = 'landing'`) holding the editable landing-page copy as jsonb

The backend's route/service layer speaks camelCase (matching the
frontend's TypeScript types, and the old Firestore shape); a small
mapper in `backend/src/lib/db.js` converts to/from the database's
snake_case columns at the boundary.

## Business rules enforced server-side

- **Publish state machine** (`services/contentService.js`): DRAFT → SCHEDULED → PUBLISHED → UNPUBLISHED/ARCHIVED, with invalid transitions rejected (see `backend/src/__tests__`).
- **Auto-publish**: a cron job (`jobs/publishScheduler.js`) calls the `publish_due_scheduled_content()` Postgres function to flip SCHEDULED content to PUBLISHED once `scheduled_at` passes — runs every minute, idempotent, atomic.
- **Plan-gated access** (`services/accessService.js`): a student only sees PUBLISHED content whose course is unlocked by an ACTIVE, non-expired subscription — checked on every request, not just hidden in the UI.
- **Protected files**: PDFs/videos are never given a public URL. `/api/files/:contentId` streams the file only after verifying the requester's access.
- **Admin student management**: suspend (deactivates the profile row and bans the Supabase Auth account via `ban_duration`, so a suspended student can't even log in), reactivate, or permanently delete (removes the profile row — subscriptions/progress cascade via foreign keys — plus the Supabase Auth account).
- **Atomic plan assignment**: switching a student's plan (cancel old subscription, create new one) runs inside the `assign_subscription()` Postgres function, so concurrent requests can never leave more than one ACTIVE subscription for the same student.

## File storage

Uploaded videos/PDFs/images are streamed to a short-lived local temp
file (never fully buffered in process memory) and then uploaded to a
private **Supabase Storage** bucket (`course-files`) via the service
role client (`backend/src/routes/upload.routes.js`); the temp file is
deleted immediately after. This keeps large-video uploads from spiking
server RAM while still working on ephemeral hosting (Render, Railway,
Cloud Run) — as long as the platform's `/tmp` is writable, which is
standard. Files are never given a permanent public URL: `GET
/api/files/:contentId` checks the requester's access, then issues a
**10-minute signed URL** for the exact file, which the frontend hands
straight to `<video>`/`<iframe>` so native HTTP range requests (video
scrubbing) keep working.

Storage objects follow a predictable, non-guessable layout:
`courses/{courseId}/{videos|pdfs|images}/{contentId}/{contentId}-{randomHex}.{ext}`
— the original filename is never used as the Storage object name.

You'll need the `course-files` bucket created in your Supabase project
(**Storage → New bucket**, public OFF) and `SUPABASE_STORAGE_BUCKET` set
in `backend/.env` (defaults to `course-files`). See `supabase/schema.sql`
for the bucket + RLS setup.

## Testing

```bash
cd backend
npm test     # unit tests: publish state machine + upload file-validation logic
```

## Production validation — Upcoming Courses

- `courses.start_at` is stored as `timestamptz` and indexed for published upcoming-course queries.
- Student Upcoming Courses are restricted to published courses included in the student's currently usable plan.
- A future-start course does **not** grant content access before its `start_at`; access automatically opens at the start time without a scheduled job.
- Courses with no `start_at` retain the existing immediate-access behavior.
- Admin datetime fields are rendered in the administrator's local timezone and converted to UTC on submission, avoiding the common `datetime-local` UTC display bug.
- Dashboard requests use partial-failure handling so an Upcoming Courses service outage does not blank the student's normal content dashboard.
- Regression tests cover future-start denial and post-start access.

Before production deployment:

```bash
npm run install:all
npm run build
npm test --prefix backend
supabase db push
```

The build/test commands must be run in CI or the deployment environment with network access to install all locked dependencies. A complete build could not be executed in the isolated validation environment when dependencies were unavailable.
