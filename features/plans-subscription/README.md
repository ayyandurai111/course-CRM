# Plans & Subscription

Plan CRUD, student subscription assignment, and the single source of truth for
"can this student access this course/content/meeting right now".

**Backend:** `plans.routes.js`, `subscriptionService.js`, `accessService.js`, `roleService.js`
**Frontend:** `components/PlansSection.tsx`, `PlanFormModal.tsx`, `LandingPlansSection.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `shared/backend-core`: `searchFilter.js` (admin filtering)

## Depended on by
`courses`, `content`, `meetings`, `admin-shell` — this is a core module, not a leaf.

## Mount
`app.use("/api/plans", require("./features/plans-subscription/backend/plans.routes"))`
