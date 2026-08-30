-- Production migration: support explicit course start dates for student
-- dashboard upcoming courses.
alter table public.courses add column if not exists start_at timestamptz;
create index if not exists courses_start_at_idx
  on public.courses (start_at) where start_at is not null;
create index if not exists courses_published_start_at_idx
  on public.courses (is_published, start_at)
  where is_published = true and start_at is not null;
