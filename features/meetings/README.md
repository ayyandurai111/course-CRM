# Meetings

Live classes via self-hosted LiveKit: room lifecycle, webhook ingestion, recording capture/resume/publish.

**Backend:** `meetings.routes.js`, `livekitWebhook.routes.js`, `meetingRecordingService.js`, `recordingConfig.lib.js`
**Frontend:** `components/MeetingRoom.tsx`, `ParticipantTile.tsx`, `MeetingsSection.tsx`,
`pages/MeetingPage.tsx`, `RecordingLayoutPage.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `features/plans-subscription` (`accessService.js` — who may join a live class)
- `features/content` (`contentService.js` — recordings become content items)
- `features/storage-upload` (`fileValidation.lib.js` — canonical storage paths for egress)
- `features/audit`
- Infra: LiveKit server (`infra/livekit/`)

## DB migrations
`20260827090000_add_live_meetings.sql`, `20260828090000_add_meeting_recordings.sql`,
`20260829150000_add_meeting_recording_segments.sql`

## Env vars
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WEBHOOK_SECRET` (see `infra/livekit/README.md`)

## Mount
`app.use("/api/meetings", require("./features/meetings/backend/meetings.routes"))`
`app.use("/api/livekit-webhook", require("./features/meetings/backend/livekitWebhook.routes"))`
