-- Live meeting recordings: a meeting's video is captured by LiveKit
-- Egress straight into this project's private Storage bucket (via
-- Supabase's S3-compatible endpoint) at the *exact* canonical path a
-- published VIDEO content item would use. That means once the egress
-- finishes, "publishing" the recording is just the normal
-- content.publishNow() flow — no separate copy/move step needed.
--
-- recording_status lifecycle:
--   NONE       -> no recording was requested/possible for this meeting
--   RECORDING  -> egress is actively capturing the live room
--   PROCESSING -> egress was stopped (meeting ended) and is finalizing
--                 the upload; not yet confirmed by the webhook
--   READY      -> LiveKit's egress_ended webhook confirmed a successful
--                 upload; recording_content_id points at a DRAFT
--                 content row an admin can preview/publish
--   FAILED     -> egress errored out or produced no usable file
alter table public.meetings
  add column if not exists recording_status text not null default 'NONE'
    check (recording_status in ('NONE','RECORDING','PROCESSING','READY','FAILED')),
  add column if not exists recording_egress_id text,
  -- Deliberately NOT a foreign key. recording_content_id is written to
  -- this row the moment a recording *starts* (see
  -- meetingRecordingService.startRecording) — well before the matching
  -- `content` row exists, which is only created once LiveKit's
  -- egress_ended webhook confirms the upload succeeded. A `references
  -- content(id)` constraint here would make Postgres reject that very
  -- first UPDATE with a foreign-key violation, since content(id)
  -- wouldn't contain the row yet. Every reader of this column
  -- (publishRecordingCore, the Meetings admin UI) already only acts on
  -- it once recording_status = 'READY', at which point the referenced
  -- content row is guaranteed to exist by the webhook handler's own
  -- ordering — so the missing FK costs no real integrity guarantee.
  add column if not exists recording_content_id uuid,
  add column if not exists recording_file_key text,
  add column if not exists recording_duration_seconds integer,
  add column if not exists recording_file_size_bytes bigint,
  add column if not exists recording_error text;

-- The egress webhook looks meetings up by egress id, and admins list
-- meetings filtered by recording readiness.
create unique index if not exists meetings_recording_egress_id_idx
  on public.meetings(recording_egress_id) where recording_egress_id is not null;
create index if not exists meetings_recording_status_idx on public.meetings(recording_status);
