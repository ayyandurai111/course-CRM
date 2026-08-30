-- Live meetings: business metadata lives in Supabase; real-time media lives
-- on the project's self-hosted LiveKit server.
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  room_name text not null unique,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED','LIVE','ENDED','CANCELLED')),
  scheduled_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_by_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_course_scheduled_idx on public.meetings(course_id, scheduled_at);
create index if not exists meetings_status_scheduled_idx on public.meetings(status, scheduled_at);

alter table public.meetings enable row level security;
revoke all on public.meetings from anon, authenticated;

