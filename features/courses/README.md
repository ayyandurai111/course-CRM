# Courses

Course CRUD, publish scheduling, slug generation with collision retry.

**Backend:** `courses.routes.js`, `publishScheduler.job.js`
**Frontend:** `components/CoursesSection.tsx`, `CourseFormModal.tsx`, `ScheduleModal.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `features/plans-subscription` (access checks reference course→plan links)
- `shared/frontend-core`: `types/index.ts`, `apiClient.ts`, `components/forms`, `components/modals`

## DB migrations
`20260823090000_add_course_start_at.sql`, `20260823210000_add_course_thumbnails_bucket.sql`

## Mount
`app.use("/api/courses", require("./features/courses/backend/courses.routes"))`
Call `startPublishScheduler()` from `publishScheduler.job.js` on server boot.
