-- ---------------------------------------------------------------------
-- content.source — distinguishes a VIDEO content row created from a
-- live class recording (meetingRecordingService.js) from one an admin
-- uploaded directly through the Content tab. The admin Edit Content
-- form uses this to hide the "Video file" replace-upload control for
-- recordings (there's no sense re-uploading over a LiveKit Egress
-- output), while still allowing the thumbnail to be changed.
--
-- Not exposed on the create/update API schema (features/content/
-- backend/content.routes.js's createContentSchema has no `source`
-- field), so it can only ever be set server-side — an admin can never
-- flip a manual upload into a fake "recording" or vice versa.
-- ---------------------------------------------------------------------
alter table public.content
  add column if not exists source text not null default 'UPLOAD'
    check (source in ('UPLOAD', 'RECORDING'));
