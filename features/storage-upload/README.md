# Storage & Upload

File upload (metered, quota-checked), signed download proxying, and background
cleanup jobs (orphan files, temp files, storage-delete retries, user-deletion retries).

**Backend:** `files.routes.js`, `upload.routes.js`, `storage.lib.js`, `meteredUploadStorage.lib.js`,
`fileValidation.lib.js`, `uploadGate.lib.js`, `orphanCleanupService.js`, `storageCleanupQueueService.js`,
`userDeletionService.js`, four `*.job.js` background jobs, `scripts/cleanupOrphanFiles.js`

## Depends on
- `shared/backend-core`: `db.js`, `rateLimitStore.js`
- `features/auth` (`authAdmin.lib.js` — used by `userDeletionService.js`)
- `features/content` (`playbackToken.lib.js` — used by `files.routes.js`)

## DB migrations
`20260823210000_add_course_thumbnails_bucket.sql` (bucket setup shared with `courses`)

## Mount
`app.use("/api/upload", require("./features/storage-upload/backend/upload.routes"))`
`app.use("/api/files", require("./features/storage-upload/backend/files.routes"))`
Call each `start*Job()` export from the `*.job.js` files on server boot.
