-- Production migration: public Storage bucket for course thumbnail
-- images, uploaded via POST /api/courses/thumbnail (admin only).
--
-- This is deliberately a SEPARATE, PUBLIC bucket from "course-files"
-- (see the bottom of schema.sql) — thumbnails need to be visible on the
-- public landing page indefinitely without auth, unlike paid course
-- content, which is private and only ever read via short-lived signed
-- URLs.
--
-- If your Supabase project restricts direct writes to storage.buckets,
-- create it via the dashboard instead (Storage > New bucket > name
-- "course-thumbnails", "Public bucket" ON) and skip this insert.
insert into storage.buckets (id, name, public)
  values ('course-thumbnails', 'course-thumbnails', true)
  on conflict (id) do update set public = true;

-- storage.objects has RLS enabled by default with no policies, so by
-- default even a "public" bucket's objects aren't readable via the
-- anon/authenticated client roles — "public" only means Storage serves
-- objects at a stable public URL without requiring a signed URL, but
-- Storage still checks RLS on read. The backend itself uses the
-- service role key (bypasses RLS), so uploads always work regardless.
-- This policy is what makes the resulting public URLs actually
-- browsable by students/visitors who aren't authenticated at all.
drop policy if exists "Public read of course thumbnails" on storage.objects;
create policy "Public read of course thumbnails"
  on storage.objects for select
  to public
  using (bucket_id = 'course-thumbnails');
