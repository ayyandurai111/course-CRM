# Shared

Foundation code every feature module depends on. Not a "feature" — copy this
alongside *any* feature module you pull into another project.

## backend-core
`db.js`, `supabase.js` — Supabase client + query helpers
`rateLimitStore.js` — express-rate-limit store selector (Redis-aware)
`urlSecurity.js` — HTTPS image URL allowlisting
`dateValidation.js`, `searchFilter.js` — input validation helpers

## frontend-core
`lib/apiClient.ts` — fetch wrapper for the backend API
`lib/supabaseClient.ts` — Supabase JS client (auth only, no direct DB/Storage access)
`lib/istTime.ts` — timezone display helpers
`types/index.ts` — shared TS types used across every feature
`components/common/*` — Icons, Skeletons, StatusPill, ErrorBoundary, etc.
`components/forms/FormFields.tsx`, `components/modals/Modal.tsx` — generic UI primitives

Requires npm workspaces (see root `package.json`) so these files — which live
outside `backend/` and `frontend/` — can resolve `node_modules`.
