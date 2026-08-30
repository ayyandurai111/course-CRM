# Students

Student roster admin view + the student-facing dashboard (stat cards, tabs, upcoming courses/lessons).

**Backend:** `students.routes.js`
**Frontend:** `components/StudentsSection.tsx`, `StatCards.tsx`, `DashboardHeader.tsx`,
`ContentTabs.tsx`, `pages/StudentDashboard.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `features/plans-subscription`
- `shared/frontend-core`: `components/common/Skeleton.tsx`, `PageSkeletons.tsx`, `types/index.ts`

## Mount
`app.use("/api/students", require("./features/students/backend/students.routes"))`
