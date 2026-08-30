-- A meeting's `recording_*` columns on the `meetings` row (added in
-- 20260828_add_meeting_recordings.sql) only ever tracked ONE egress at
-- a time. That's fine for the common case, but LiveKit's Egress
-- process stops itself once the room it's recording has zero
-- participants — so if the only person in a live class (typically the
-- admin) disconnects and later rejoins the SAME still-LIVE meeting,
-- the original egress is already gone by the time they're back. There
-- is no way to "resume" a stopped Egress mid-file (it isn't append-
-- able), so continuing to record across that gap means starting a
-- brand new egress as a new segment, while keeping the earlier
-- segment's file (if it finished successfully) instead of losing it.
--
-- This table is that history. `meetings.recording_*` continues to
-- describe the CURRENT/most-recent segment (unchanged reader
-- contract for the existing admin UI and publish flow); whenever a
-- rejoin starts a fresh segment, the segment that was just superseded
-- is archived here first. The webhook handler checks here too, since
-- an older segment's `egress_ended` event can still arrive after a
-- newer segment has already overwritten `meetings.recording_egress_id`.
create table if not exists public.meeting_recording_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  -- Order segments were started in, for display (1st, 2nd, ... recording).
  segment_number integer not null,
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING','READY','FAILED')),
  egress_id text,
  -- Same "deliberately not a foreign key" reasoning as
  -- meetings.recording_content_id — see that column's comment.
  content_id uuid,
  file_key text,
  duration_seconds integer,
  file_size_bytes bigint,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists meeting_recording_segments_egress_id_idx
  on public.meeting_recording_segments(egress_id) where egress_id is not null;
create index if not exists meeting_recording_segments_meeting_id_idx
  on public.meeting_recording_segments(meeting_id);

alter table public.meeting_recording_segments enable row level security;
revoke all on public.meeting_recording_segments from anon, authenticated;

