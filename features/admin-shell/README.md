# Admin Shell

The admin panel's outer chrome: sidebar nav, overview stats, and the generic
`/api/admin/*` + `/api/me` endpoints other admin sections call into.

**Backend:** `admin.routes.js`, `me.routes.js`
**Frontend:** `components/AdminSidebar.tsx`, `OverviewSection.tsx`, `pages/AdminPanel.tsx`

## Depends on
- `shared/backend-core`: `db.js`, `searchFilter.js`
- `features/auth` (`auth.middleware.js`)
- `features/audit`
- `features/plans-subscription` (`roleService.js`, `subscriptionService.js`)
- All other admin sections render *inside* `AdminPanel.tsx` — this is the shell, not a leaf.

## Mount
`app.use("/api/admin", require("./features/admin-shell/backend/admin.routes"))`
`app.use("/api/me", require("./features/admin-shell/backend/me.routes"))`
