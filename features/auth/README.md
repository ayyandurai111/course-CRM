# Auth

Login (Supabase Auth + Google OAuth), session verification, admin bootstrap, and safe account deletion.

**Backend:** `auth.routes.js`, `auth.middleware.js`, `authAdmin.lib.js`, `bootstrapToken.lib.js`
**Frontend:** `context/AuthContext.tsx`, `pages/LoginPage.tsx`

## Depends on
- `shared/backend-core`: `db.js`, `supabase.js`, `urlSecurity.js`
- `shared/frontend-core`: `lib/apiClient.ts`, `lib/supabaseClient.ts`, `types/index.ts`
- `features/audit` (logs auth events)
- `features/storage-upload` (`userDeletionService.js` — safe account deletion)

## DB migrations
`supabase/migrations/20260829120000_sync_google_avatar_on_login.sql`
(base `users` table + `get_or_create_user_profile()` RPC comes from `supabase/schema.sql`)

## Env vars
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_EMAIL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Mount
`app.use("/api/auth", require("./features/auth/backend/auth.routes"))`
