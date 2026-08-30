# Content

Video/PDF/Post lessons: playback tokens, signed URLs, progress tracking (resume position).

**Backend:** `content.routes.js`, `contentService.js`, `playbackToken.lib.js`
**Frontend:** `components/VideoPlayerModal.tsx`, `PdfViewerModal.tsx`, `PostViewerModal.tsx`,
`ContentCard.tsx`, `ContentSection.tsx`, `ContentFormModal.tsx`, `VideoThumbnailPicker.tsx`,
`hooks/useProtectedFile.ts`

## Depends on
- `shared/backend-core`: `db.js`
- `features/plans-subscription` (`accessService.js` — who can view this content)
- `features/storage-upload` (`storage.lib.js`, `files.routes.js` — where the file actually lives)
- `shared/frontend-core`: `types/index.ts`, `apiClient.ts`

## DB migrations
`20260825090000_add_last_position_seconds.sql`

## Mount
`app.use("/api/content", require("./features/content/backend/content.routes"))`
