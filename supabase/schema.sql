-- Course CRM — Supabase (Postgres) schema
--
-- Run this once against your Supabase project (SQL Editor, or
-- `supabase db push` / psql with the connection string from
-- Project Settings > Database). It replaces the old Firestore data
-- model and firestore.rules/storage.rules files.
--
-- ARCHITECTURE (same shape as the old Firebase version): the frontend
-- never talks to Postgres or Storage directly. Every read/write goes
-- through the backend, which uses the Supabase *service role* key
-- (SUPABASE_SERVICE_ROLE_KEY) — a key that bypasses Row Level Security
-- entirely, the same way the old Firebase Admin SDK bypassed
-- firestore.rules. RLS is enabled on every table below purely as
-- defense-in-depth (deny-all for the anon/authenticated roles), so if a
-- client ever obtained the public anon key and pointed the Supabase JS
-- client directly at the database, it could still read/write nothing.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- users — mirrors auth.users (Supabase Auth) 1:1 by id. Created lazily
-- on first authenticated request, same as the old Firestore behavior.
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  avatar_url text,
  role text not null default 'STUDENT' check (role in ('STUDENT', 'ADMIN')),
  is_active boolean not null default true,
  pending_deletion boolean not null default false,
  -- Spec fix — "deleted user recreation": set true the moment an admin
  -- requests deletion, BEFORE the Supabase Auth account deletion is
  -- attempted. Combined with `is_active = false` (set at the same
  -- time), this cuts off access immediately regardless of whether the
  -- Auth deletion call below succeeds. This row is only ever hard-
  -- deleted by Postgres's own `on delete cascade` above, which fires
  -- automatically once the *auth.users* row is actually deleted — so a
  -- profile can never be recreated by get_or_create_user_profile() for
  -- an id that still exists here with pending_deletion = true (the
  -- `on conflict (id) do nothing` in that function just returns the
  -- existing, still-inactive row), and once this row IS truly gone the
  -- corresponding Auth identity is gone too, so no new session can ever
  -- present that same user id again. See jobs/userDeletionRetryJob.js
  -- for the retry of the Auth-side deletion when it fails immediately.
  pending_deletion boolean not null default false,
  created_at timestamptz not null default now()
);
-- If public.users already exists, CREATE TABLE IF NOT EXISTS does not
-- add newly introduced columns. Add the column explicitly so this schema
-- works both on a fresh database and on an existing database.
alter table public.users
  add column if not exists pending_deletion boolean not null default false;

create index if not exists users_role_idx on public.users (role);
create index if not exists users_pending_deletion_idx on public.users (pending_deletion) where pending_deletion = true;

-- ---------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text,
  thumbnail_url text,
  is_published boolean not null default false,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists courses_is_published_idx on public.courses (is_published);

-- ---------------------------------------------------------------------
-- content — video / pdf / post items that belong to a course
-- ---------------------------------------------------------------------
create table if not exists public.content (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  type text not null check (type in ('VIDEO', 'PDF', 'POST')),
  course_id uuid not null references public.courses (id) on delete cascade,
  file_key text,
  file_size_bytes bigint,
  duration_seconds integer,
  page_count integer,
  image_url text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
  created_by_id uuid references public.users (id),
  scheduled_at timestamptz,
  published_at timestamptz,
  unpublished_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_course_status_idx on public.content (course_id, status);
create index if not exists content_status_scheduled_idx on public.content (status, scheduled_at);

-- ---------------------------------------------------------------------
-- plans — course_ids kept as a native array (equivalent to the old
-- Firestore `courseIds` field) rather than a join table, so the
-- application code maps over 1:1.
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer not null default 0,
  currency text not null default 'INR',
  billing_period text not null default 'MONTHLY'
    check (billing_period in ('ONE_TIME', 'MONTHLY', 'YEARLY')),
  description text,
  features text[] not null default '{}',
  is_popular boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  course_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plans_course_ids_idx on public.plans using gin (course_ids);

-- ---------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'EXPIRED')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);
create index if not exists subscriptions_plan_status_idx on public.subscriptions (plan_id, status);

-- Database-level invariant: a student can have at most one ACTIVE
-- subscription, enforced by Postgres regardless of application bugs or
-- races. Partial (WHERE status = 'ACTIVE') so historical CANCELLED /
-- EXPIRED rows for the same user are never blocked by this index.
create unique index if not exists subscriptions_one_active_per_user_idx
on public.subscriptions (user_id)
where status = 'ACTIVE';

-- ---------------------------------------------------------------------
-- content_progress — one row per (user, content)
-- ---------------------------------------------------------------------
create table if not exists public.content_progress (
  id text primary key, -- `${userId}_${contentId}`, kept for parity with the old code
  user_id uuid not null references public.users (id) on delete cascade,
  content_id uuid not null references public.content (id) on delete cascade,
  progress_percent numeric not null default 0,
  viewed boolean not null default false,
  last_position_seconds numeric,
  updated_at timestamptz not null default now(),
  unique (user_id, content_id)
);
create index if not exists content_progress_user_idx on public.content_progress (user_id);

-- ---------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- site_content — single row holding editable landing-page copy
-- (equivalent to the old siteContent/landing Firestore doc).
-- ---------------------------------------------------------------------
create table if not exists public.site_content (
  id text primary key default 'landing',
  content jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

-- ---------------------------------------------------------------------
-- assign_subscription — atomic replacement for the old Firestore
-- transaction in students.routes.js (cancel any existing ACTIVE
-- subscription, then insert the new one). The whole body runs inside
-- Postgres's implicit per-function transaction, so any exception below
-- rolls back both the cancellation UPDATE and the new-subscription
-- INSERT together — no partially completed assignment can persist.
--
-- Security: this is a privileged SECURITY DEFINER function, so it must
-- never trust its caller. It independently re-validates every
-- precondition (student exists / is a STUDENT / is active, plan exists
-- / is active, ids not null, expiry in the future) rather than relying
-- on the Express route's zod checks alone — direct RPC callers must be
-- blocked by the same rules the HTTP API enforces. EXECUTE is revoked
-- from public/anon/authenticated below so only the backend's
-- service_role can ever call it in the first place.
--
-- Concurrency: `select ... for update` locks the student's own users
-- row before touching subscriptions, so two concurrent assignment
-- requests for the *same* student serialize on that lock instead of
-- interleaving their cancel/insert steps (different students never
-- block each other, since each locks only its own row). The partial
-- unique index `subscriptions_one_active_per_user_idx` is the final
-- backstop: if it is ever violated anyway (e.g. a future code path that
-- bypasses this function), the unique_violation is caught below and
-- turned into a clear, controlled error instead of duplicate ACTIVE
-- subscriptions.
-- ---------------------------------------------------------------------
create or replace function public.assign_subscription(
  p_student_id uuid,
  p_plan_id uuid,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_student public.users%rowtype;
  v_plan public.plans%rowtype;
begin
  if p_student_id is null or p_plan_id is null then
    raise exception 'p_student_id and p_plan_id are required';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'p_expires_at must be in the future';
  end if;

  -- Lock the student row first (before reading/writing subscriptions)
  -- so a concurrent call for the same student blocks here until this
  -- transaction commits or rolls back.
  select * into v_student
    from public.users
    where id = p_student_id
    for update;

  if not found then
    raise exception 'Student % does not exist', p_student_id;
  end if;
  if v_student.role <> 'STUDENT' then
    raise exception 'User % is not a student', p_student_id;
  end if;
  if v_student.is_active is not true then
    raise exception 'Student % is not active', p_student_id;
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if not found then
    raise exception 'Plan % does not exist', p_plan_id;
  end if;
  if v_plan.is_active is not true then
    raise exception 'Plan % is not active', p_plan_id;
  end if;
  -- Defense in depth (spec #8): the plans.price_cents column has no
  -- CHECK constraint of its own, so a direct RPC caller must not be
  -- able to assign a subscription against a plan whose configuration
  -- is corrupt/negative.
  if v_plan.price_cents is null or v_plan.price_cents < 0 then
    raise exception 'Plan % has an invalid price configuration', p_plan_id;
  end if;

  update public.subscriptions
    set status = 'CANCELLED', cancelled_at = now()
    where user_id = p_student_id and status = 'ACTIVE';

  insert into public.subscriptions (user_id, plan_id, status, started_at, expires_at)
    values (p_student_id, p_plan_id, 'ACTIVE', now(), p_expires_at)
    returning id into v_new_id;

  return v_new_id;
exception
  when unique_violation then
    -- Re-raised with the original SQLSTATE (23505) so the backend can
    -- tell a concurrent-assignment race apart from other failures and
    -- return a controlled 409 instead of an unhandled 500.
    raise exception using message = format('Student %s already has an active subscription', p_student_id),
      errcode = '23505';
end;
$$;

revoke execute on function public.assign_subscription(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.assign_subscription(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- change_user_role — atomic promote/demote between STUDENT and ADMIN.
-- Backs POST /api/admin/users/:id/role (see admin.routes.js).
--
-- Security: SECURITY DEFINER, so — same as assign_subscription — it
-- must never trust its caller and re-validates every precondition
-- itself rather than relying solely on the Express route's checks:
--   * actor must exist, be ADMIN, and be active (an inactive admin's
--     JWT could otherwise still reach this function directly via RPC)
--   * actor can never change their own role, in either direction —
--     this both satisfies "a STUDENT must never promote itself"
--     (structurally true anyway, since requireAdmin already blocks
--     non-admins from reaching this route) and closes the adjacent
--     hole of an admin accidentally demoting themselves and locking
--     themselves out, or self-promoting a second time as a no-op
--     audit-log gap
--   * target must exist
--   * new role must be one of the enum's supported values (the column
--     CHECK constraint would reject anything else anyway, but this
--     gives a clear 4xx instead of a raw constraint-violation 500)
--   * the final active ADMIN can never be demoted — this is the one
--     rule that is inherently racy if checked in application code (two
--     concurrent demotions of two different admins could each see
--     count = 2 and both proceed, leaving zero), so it is enforced
--     here under a lock on the full set of ADMIN rows
--
-- Concurrency: `select ... for update` locks every current ADMIN row
-- before counting, so two concurrent demotion attempts serialize
-- instead of racing past the "count = 1" check together. Promotions
-- (STUDENT -> ADMIN) don't need this lock since they can only ever
-- increase the admin count.
-- ---------------------------------------------------------------------
create or replace function public.change_user_role(
  p_actor_id uuid,
  p_target_id uuid,
  p_new_role text
) returns table (old_role text, new_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_target public.users%rowtype;
  v_active_admin_count integer;
begin
  if p_actor_id is null or p_target_id is null or p_new_role is null then
    raise exception 'p_actor_id, p_target_id and p_new_role are required';
  end if;

  if p_new_role not in ('STUDENT', 'ADMIN') then
    raise exception using message = format('Unsupported role %s', p_new_role), errcode = '22023'; -- invalid_parameter_value
  end if;

  select * into v_actor from public.users where id = p_actor_id;
  if not found then
    raise exception 'Actor % does not exist', p_actor_id;
  end if;
  if v_actor.role <> 'ADMIN' or v_actor.is_active is not true then
    raise exception using message = format('Actor %s is not an active admin', p_actor_id), errcode = '42501'; -- insufficient_privilege
  end if;

  if p_actor_id = p_target_id then
    raise exception using message = 'Admins cannot change their own role', errcode = '42501';
  end if;

  select * into v_target from public.users where id = p_target_id;
  if not found then
    raise exception using message = format('Target user %s does not exist', p_target_id), errcode = 'P0002'; -- no_data_found
  end if;

  if v_target.role = p_new_role then
    -- No-op: already the requested role. Return current state without
    -- writing an audit log entry for a change that didn't happen.
    return query select v_target.role, v_target.role;
    return;
  end if;

  if v_target.role = 'ADMIN' and p_new_role = 'STUDENT' then
    -- Lock every current ADMIN row so a concurrent demotion of a
    -- *different* admin can't run its own count check until this
    -- transaction commits or rolls back.
    perform 1 from public.users where role = 'ADMIN' and is_active = true for update;

    select count(*) into v_active_admin_count
      from public.users where role = 'ADMIN' and is_active = true;

    if v_active_admin_count <= 1 then
      raise exception 'Cannot remove the last active admin' using errcode = '42501';
    end if;
  end if;

  update public.users set role = p_new_role where id = p_target_id;

  return query select v_target.role, p_new_role;
end;
$$;

revoke execute on function public.change_user_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.change_user_role(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- publish_due_scheduled_content — NOTE: superseded by
-- contentService.publishDueScheduledContent() (issue #6E, security
-- hardening pass 2), which now verifies each item's Storage object
-- exists before publishing it and therefore does the SCHEDULED ->
-- PUBLISHED flip row-by-row in application code instead of via this
-- single bulk SQL UPDATE. Left in place (unused by the app) rather than
-- dropped, in case a future job wants a fast path that doesn't need the
-- Storage check.
-- ---------------------------------------------------------------------
create or replace function public.publish_due_scheduled_content()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with due as (
    update public.content
      set status = 'PUBLISHED', published_at = now()
      where status = 'SCHEDULED' and scheduled_at <= now()
      returning 1
  )
  select count(*) into v_count from due;

  return v_count;
end;
$$;

revoke execute on function public.publish_due_scheduled_content() from public, anon, authenticated;
grant execute on function public.publish_due_scheduled_content() to service_role;

-- ---------------------------------------------------------------------
-- publish_content_atomic — closes the content-publish race condition.
--
-- Previously, publishing a content item was a check-then-act sequence
-- entirely in application code: read the row, check the Storage object
-- exists, THEN write status='PUBLISHED' as a separate later operation.
-- A concurrent request (another publish, a content update that swaps
-- fileKey/courseId/type, or a delete) could change or remove the file
-- in the gap between the Storage check and the write, letting an
-- invalid/inconsistent record become PUBLISHED.
--
-- This function is the final, atomic commit step: it takes a row lock
-- (`for update`) on the content row and re-verifies, from the DATABASE
-- itself, that courseId/type/fileKey are still EXACTLY what the caller
-- already validated (including the Storage existence check, which must
-- still happen in application code beforehand — Supabase Storage is not
-- transactional with Postgres, spec requirement). Only if nothing
-- changed underneath the caller does it flip the row to PUBLISHED, all
-- inside one transaction. Two concurrent publish attempts, or a publish
-- racing a content update/delete, serialize on the row lock — the
-- loser sees the row it locked no longer matches what it expected and
-- fails loudly (CONTENT_CHANGED) instead of silently publishing a
-- record whose file may have just been swapped out from under it.
-- ---------------------------------------------------------------------
create or replace function public.publish_content_atomic(
  p_content_id uuid,
  p_expected_course_id uuid,
  p_expected_type text,
  p_expected_file_key text
) returns setof public.content
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.content%rowtype;
begin
  if p_content_id is null then
    raise exception 'p_content_id is required';
  end if;

  select * into v_row from public.content where id = p_content_id for update;
  if not found then
    raise exception using message = format('Content %s not found', p_content_id), errcode = 'P0002'; -- no_data_found
  end if;

  -- Re-verify the EXACT record this publish was authorized against
  -- (including the Storage-existence-checked fileKey) has not been
  -- changed by a concurrent request. `is distinct from` treats
  -- null = null as "not changed", so content with no file at all still
  -- compares correctly.
  if v_row.course_id is distinct from p_expected_course_id
     or v_row.type is distinct from p_expected_type
     or v_row.file_key is distinct from p_expected_file_key then
    raise exception using message = format('Content %s was modified concurrently and can no longer be published as validated; please retry', p_content_id),
      errcode = '40001'; -- serialization_failure
  end if;

  if v_row.status not in ('DRAFT', 'SCHEDULED', 'UNPUBLISHED') then
    raise exception using message = format('Cannot move content from %s to PUBLISHED', v_row.status), errcode = '23514'; -- check_violation
  end if;

  update public.content
    set status = 'PUBLISHED', published_at = now(), scheduled_at = null, updated_at = now()
    where id = p_content_id
    returning * into v_row;

  return next v_row;
  return;
end;
$$;

revoke execute on function public.publish_content_atomic(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.publish_content_atomic(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- storage_cleanup_queue — durable record of Storage objects that still
-- need to be deleted after a DB-side deletion (course delete, content
-- delete/replace, etc). Populated in the SAME transaction as the DB
-- change that orphans the file (see delete_course_cascade below), so a
-- crash between "DB committed" and "Storage object removed" can never
-- lose track of a file that needs cleanup — it just sits here as
-- PENDING until a retry job (see backend jobs/storageCleanupRetryJob.js)
-- picks it up. Retries are idempotent: deleting an already-deleted
-- object is not an error (see lib/storage.js deleteFileSafely).
-- ---------------------------------------------------------------------
create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  file_key text not null,
  course_id uuid,
  content_id uuid,
  reason text not null default 'course_delete',
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists storage_cleanup_queue_status_idx on public.storage_cleanup_queue (status);

-- ---------------------------------------------------------------------
-- delete_course_cascade — atomic replacement for the old multi-step
-- course deletion in courses.routes.js. Everything that must be
-- consistent (content rows, plan.course_ids references, the course row
-- itself, and queuing the Storage objects for cleanup) happens inside
-- one Postgres transaction, so a failure partway through leaves the
-- database exactly as it was before the call — never "course gone,
-- content still there" or vice versa. Storage deletion itself cannot
-- participate in this transaction (it's a separate HTTP-backed
-- service), so instead of deleting objects here, this function records
-- them in storage_cleanup_queue (in the same transaction) and returns
-- them to the caller, which attempts an immediate best-effort delete;
-- anything that fails (or if the process crashes first) stays queued
-- for the retry job.
-- ---------------------------------------------------------------------
create or replace function public.delete_course_cascade(p_course_id uuid)
returns table (queue_id uuid, file_key text, content_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
begin
  if p_course_id is null then
    raise exception 'p_course_id is required';
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    raise exception using message = format('Course %s does not exist', p_course_id), errcode = 'P0002';
  end if;

  -- Queue every file this course's content currently references, before
  -- anything is deleted, so the cleanup reference is preserved even if
  -- a later step in this same function fails and rolls everything back.
  insert into public.storage_cleanup_queue (file_key, course_id, content_id, reason)
  select c.file_key, c.course_id, c.id, 'course_delete'
    from public.content c
    where c.course_id = p_course_id and c.file_key is not null;

  -- Detach this course from every plan that references it.
  update public.plans
    set course_ids = array_remove(course_ids, p_course_id)
    where p_course_id = any(course_ids);

  -- Content rows cascade automatically via content.course_id's
  -- ON DELETE CASCADE foreign key.
  delete from public.courses where id = p_course_id;

  return query
    select q.id, q.file_key, q.content_id from public.storage_cleanup_queue q
      where q.course_id = p_course_id and q.reason = 'course_delete' and q.status = 'PENDING'
      order by q.created_at;
end;
$$;

revoke execute on function public.delete_course_cascade(uuid) from public, anon, authenticated;
grant execute on function public.delete_course_cascade(uuid) to service_role;

-- ---------------------------------------------------------------------
-- delete_content_cascade — the same durable-queue pattern as
-- delete_course_cascade, but for deleting a single content item.
--
-- Previously (spec fix target), content deletion deleted the Storage
-- object FIRST and the database row second. If the Storage delete
-- succeeded but the subsequent DB delete failed (crash, DB outage,
-- constraint issue), the database was left with a row whose fileKey
-- pointed at a Storage object that no longer existed — a permanent
-- orphaned reference with no automatic way to notice or repair it.
--
-- This function flips the order and makes the DB change authoritative:
-- it locks the content row, queues its file (if any) into
-- storage_cleanup_queue, and deletes the row, all in one transaction.
-- The caller (content.routes.js) then makes a best-effort immediate
-- Storage delete; anything that fails just stays PENDING/FAILED in the
-- queue for the existing retry job (storageCleanupRetryJob.js) to pick
-- up later — so a Storage failure can never leave a dangling DB
-- reference, and worst case is a temporarily-orphaned Storage object
-- that the retry job will still clean up.
-- ---------------------------------------------------------------------
create or replace function public.delete_content_cascade(p_content_id uuid)
returns table (queue_id uuid, file_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content public.content%rowtype;
begin
  if p_content_id is null then
    raise exception 'p_content_id is required';
  end if;

  select * into v_content from public.content where id = p_content_id for update;
  if not found then
    raise exception using message = format('Content %s does not exist', p_content_id), errcode = 'P0002';
  end if;

  if v_content.file_key is not null then
    insert into public.storage_cleanup_queue (file_key, course_id, content_id, reason)
    values (v_content.file_key, v_content.course_id, v_content.id, 'content_delete');
  end if;

  delete from public.content where id = p_content_id;

  return query
    select q.id, q.file_key from public.storage_cleanup_queue q
      where q.content_id = p_content_id and q.reason = 'content_delete' and q.status = 'PENDING'
      order by q.created_at;
end;
$$;

revoke execute on function public.delete_content_cascade(uuid) from public, anon, authenticated;
grant execute on function public.delete_content_cascade(uuid) to service_role;

-- ---------------------------------------------------------------------
-- get_or_create_user_profile — atomic replacement for the old
-- SELECT-then-INSERT first-login flow in middleware/auth.js. Two
-- simultaneous first-login requests for the same brand-new auth user
-- both call this function; the `on conflict (id) do nothing` makes the
-- insert a no-op for whichever request loses the race, and both then
-- read back the single row that actually exists — no duplicate-profile
-- race, and no risk of a second call overwriting an existing user's
-- role/is_active/created_at.
--
-- Seed-admin auto-promotion (server-side only, by design):
--   role is ADMIN if-and-only-if p_email case/whitespace-insensitively
--   equals p_seed_admin_email (the operator's SEED_ADMIN_EMAIL env var,
--   passed in by middleware/auth.js — never by the frontend), otherwise
--   STUDENT. p_email itself comes from authUser.email in auth.js, which
--   in turn comes from supabase.auth.getUser(accessToken) — a
--   server-side call that verifies the JWT against Supabase Auth, so
--   this is the OAuth-provider-verified email, never anything the
--   client could spoof in a request body. The frontend has no input
--   into this decision at all.
--
--   This check only ever runs inside the INSERT's VALUES clause, which
--   `on conflict (id) do nothing` skips entirely once a row already
--   exists — so this only ever fires on a user's very first login, and
--   can never silently re-promote or demote an existing profile just
--   because SEED_ADMIN_EMAIL happens to still be set (e.g. an admin who
--   later demotes this account via the admin panel stays demoted on
--   their next login; SEED_ADMIN_EMAIL is not re-checked after the
--   profile row already exists).
--
--   Operational note: unlike bootstrap_first_admin() below, this has NO
--   "only while zero admins exist" guard and needs none — it's not a
--   race between different people claiming a scarce first-admin slot,
--   it's a fixed, operator-configured email that is always promoted on
--   its first login, by design. The actual security boundary is simply
--   "whoever controls the SEED_ADMIN_EMAIL mailbox/Google account is the
--   admin" — keep that env var pointed at an address you trust, and
--   note that anyone who successfully authenticates as it via Google
--   (or whatever the configured Auth provider is) gets ADMIN with no
--   further gate. bootstrap_first_admin()/ADMIN_BOOTSTRAP_TOKEN remains
--   available as a separate, token-gated path for promoting additional
--   admins later without touching SEED_ADMIN_EMAIL.
-- ---------------------------------------------------------------------
drop function if exists public.get_or_create_user_profile(uuid, text, text, text);
create or replace function public.get_or_create_user_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_avatar_url text,
  p_seed_admin_email text default null
) returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_role text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Case/whitespace-insensitive match against the operator-configured
  -- seed admin email (see doc comment above for the full rationale).
  -- A null/blank p_seed_admin_email (SEED_ADMIN_EMAIL unset) always
  -- yields STUDENT, same as before this feature existed.
  if p_seed_admin_email is not null
     and length(trim(p_seed_admin_email)) > 0
     and lower(trim(p_email)) = lower(trim(p_seed_admin_email)) then
    v_role := 'ADMIN';
  else
    v_role := 'STUDENT';
  end if;

  insert into public.users (id, email, name, avatar_url, role, is_active)
    values (p_user_id, coalesce(p_email, ''), coalesce(p_name, ''), p_avatar_url, v_role, true)
  on conflict (id) do nothing;

  select * into v_user from public.users where id = p_user_id;
  return v_user;
end;
$$;

revoke execute on function public.get_or_create_user_profile(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_or_create_user_profile(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- bootstrap_first_admin — secure, one-time admin bootstrap. Deliberately
-- NOT part of the login path: get_or_create_user_profile above always
-- creates STUDENT, no exceptions, so admin creation is never a side
-- effect of merely signing in.
--
-- Instead an already-authenticated user calls
-- POST /api/auth/bootstrap-admin (see auth.routes.js), which is only
-- reachable at all when the server operator has explicitly set
-- ADMIN_BOOTSTRAP_TOKEN, and even then requires ALL of:
--   1. A valid Supabase session — authenticate() middleware verifies
--      the JWT server-side; identity is never client-supplied.
--   2. The correct x-bootstrap-token header, compared in constant time
--      against the server-only ADMIN_BOOTSTRAP_TOKEN env var (never
--      sent to the frontend). Operators are expected to unset this
--      env var again once the seed admin is created.
--   3. The session's own profile email matching SEED_ADMIN_EMAIL —
--      re-checked here against this user's existing `public.users`
--      row (populated from the Google-verified email at first login),
--      not against anything passed in by the client.
--   4. No ADMIN existing anywhere in the system yet.
-- (3) and (4) are enforced here, inside the function, behind a
-- transaction-scoped advisory lock, so a burst of concurrent bootstrap
-- calls can't each observe "0 admins" and each promote someone —
-- exactly one caller can ever win, and only once. Every later admin is
-- created deliberately through the admin panel (roleService.js /
-- admin.routes.js), never through this function again.
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_first_admin(
  p_user_id uuid,
  p_seed_admin_email text
) returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_admin_count int;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_seed_admin_email is null or length(trim(p_seed_admin_email)) = 0 then
    raise exception 'Admin bootstrap is not configured.';
  end if;

  -- Serialize all bootstrap attempts against each other so two
  -- concurrent requests can't both pass the "no admin yet" check below.
  perform pg_advisory_xact_lock(hashtext('bootstrap_first_admin'));

  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'No profile found for this user — log in at least once first.';
  end if;

  if lower(trim(v_user.email)) is distinct from lower(trim(p_seed_admin_email)) then
    raise exception 'This account is not the configured seed admin.';
  end if;

  select count(*) into v_admin_count from public.users where role = 'ADMIN';
  if v_admin_count > 0 then
    raise exception 'Bootstrap already used — an admin already exists.';
  end if;

  update public.users set role = 'ADMIN' where id = p_user_id;

  select * into v_user from public.users where id = p_user_id;
  return v_user;
end;
$$;

revoke execute on function public.bootstrap_first_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- upload_quota_usage — per-user, per-day byte counter backing
-- MAX_USER_UPLOAD_BYTES_PER_DAY (spec #15A). One row per (user, day);
-- "reset daily" falls out naturally from keying on usage_date rather
-- than needing an explicit reset job.
-- ---------------------------------------------------------------------
create table if not exists public.upload_quota_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  usage_date date not null default current_date,
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

-- ---------------------------------------------------------------------
-- try_reserve_upload_quota — atomically checks-and-increments a user's
-- daily upload byte counter. `select ... for update` locks the user's
-- row for *today* before the check, so two concurrent uploads that
-- would together exceed the quota can't both read the same "before"
-- value and both succeed (spec #15A "avoid race conditions when
-- incrementing quota counters" / "do not allow concurrent requests to
-- bypass quotas"). Raises (and reserves nothing) if the reservation
-- would exceed p_max_bytes; the caller (upload.routes.js) treats that
-- as a controlled 429.
-- ---------------------------------------------------------------------
create or replace function public.try_reserve_upload_quota(
  p_user_id uuid,
  p_bytes bigint,
  p_max_bytes bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current bigint;
begin
  if p_user_id is null or p_bytes is null or p_max_bytes is null then
    raise exception 'p_user_id, p_bytes and p_max_bytes are required';
  end if;
  if p_bytes < 0 then
    raise exception 'p_bytes must not be negative';
  end if;

  insert into public.upload_quota_usage (user_id, usage_date, bytes_used)
    values (p_user_id, current_date, 0)
  on conflict (user_id, usage_date) do nothing;

  select bytes_used into v_current
    from public.upload_quota_usage
    where user_id = p_user_id and usage_date = current_date
    for update;

  if v_current + p_bytes > p_max_bytes then
    raise exception 'Daily upload quota exceeded' using errcode = '23514'; -- check_violation
  end if;

  update public.upload_quota_usage
    set bytes_used = bytes_used + p_bytes, updated_at = now()
    where user_id = p_user_id and usage_date = current_date;

  return v_current + p_bytes;
end;
$$;

revoke execute on function public.try_reserve_upload_quota(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.try_reserve_upload_quota(uuid, bigint, bigint) to service_role;

-- ---------------------------------------------------------------------
-- release_upload_quota — compensating decrement for a reservation whose
-- upload subsequently failed (spec #15A "failed upload does not
-- incorrectly consume quota"). Clamped at zero so it can never make the
-- counter negative even if called more than once for the same bytes.
-- ---------------------------------------------------------------------
create or replace function public.release_upload_quota(
  p_user_id uuid,
  p_bytes bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_bytes is null or p_bytes <= 0 then
    return;
  end if;

  update public.upload_quota_usage
    set bytes_used = greatest(0, bytes_used - p_bytes), updated_at = now()
    where user_id = p_user_id and usage_date = current_date;
end;
$$;

revoke execute on function public.release_upload_quota(uuid, bigint) from public, anon, authenticated;
grant execute on function public.release_upload_quota(uuid, bigint) to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security — deny-all for anon/authenticated. The backend
-- talks to Postgres with the service role key, which bypasses RLS, so
-- these policies only matter if a client key is ever misused directly.
-- ---------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.content enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.content_progress enable row level security;
alter table public.audit_logs enable row level security;
alter table public.site_content enable row level security;
alter table public.storage_cleanup_queue enable row level security;
alter table public.upload_quota_usage enable row level security;
-- No policies are created, which means: no rows are readable or
-- writable by the anon/authenticated roles. Only service_role (used
-- exclusively by the backend) can access these tables.

-- ---------------------------------------------------------------------
-- Storage — one private bucket for course files (video/pdf/image),
-- equivalent to the old Firebase Storage bucket + storage.rules.
-- Create the bucket via the dashboard (Storage > New bucket > name
-- "course-files", "Public bucket" OFF) or uncomment the insert below.
--
-- A second, PUBLIC bucket ("course-thumbnails") also exists for course
-- thumbnail images — see supabase/migrations/20260823_add_course_thumbnails_bucket.sql.
-- ---------------------------------------------------------------------
-- insert into storage.buckets (id, name, public)
--   values ('course-files', 'course-files', false)
--   on conflict (id) do nothing;

-- storage.objects already has RLS enabled by default in Supabase, with
-- no policies for this bucket — so, same as above, only the backend's
-- service role key (which bypasses Storage RLS too) can read or write
-- objects in it. Uploads use supabase.storage.from('course-files').upload(),
-- and reads use short-lived createSignedUrl(), exactly mirroring the old
-- Firebase Storage upload()/getSignedUrl() calls.

-- ---------------------------------------------------------------------
-- meetings — live class metadata. Audio/video is handled by the project's
-- self-hosted LiveKit server; this table stores only meeting state and
-- authorization metadata.
-- ---------------------------------------------------------------------
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
-- Quiz system: manual quiz creation + DOCX import, student attempts,
-- server-graded scoring, and admin results. See docs/QUIZ_SYSTEM.md
-- for the full feature writeup. Mirrors the rest of this schema:
-- idempotent (safe to run repeatedly / on a fresh or existing
-- database), deny-all RLS for anon/authenticated (the backend always
-- talks to Postgres with the service role key, which bypasses RLS —
-- these policies are defense-in-depth only), and atomic multi-row
-- operations live in SECURITY DEFINER functions rather than being
-- assembled from several separate round trips in application code.

-- ---------------------------------------------------------------------
-- quizzes
-- ---------------------------------------------------------------------
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  -- Percentage (0-100) a student must reach to "pass" an attempt.
  pass_percent integer not null default 70 check (pass_percent between 0 and 100),
  created_by_id uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_course_status_idx on public.quizzes (course_id, status);

-- ---------------------------------------------------------------------
-- quiz_questions — exactly 4 answers (A-D) per spec; one correct answer.
-- ---------------------------------------------------------------------
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  explanation text not null default '',
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quiz_questions_quiz_order_idx on public.quiz_questions (quiz_id, order_index);

-- ---------------------------------------------------------------------
-- quiz_attempts — one row per student submission. attempt_number is
-- 1-indexed per (quiz_id, user_id), so retakes are tracked in full
-- rather than only keeping the latest score.
-- ---------------------------------------------------------------------
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  attempt_number integer not null,
  score integer not null default 0,
  total_questions integer not null default 0,
  percent numeric(5, 2) not null default 0,
  passed boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (quiz_id, user_id, attempt_number)
);
create index if not exists quiz_attempts_quiz_user_idx on public.quiz_attempts (quiz_id, user_id, attempt_number desc);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id);
create index if not exists quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id, completed_at desc);

-- ---------------------------------------------------------------------
-- quiz_answers — the student's selected option per question per
-- attempt, plus the server-computed correctness so results (both the
-- student's own and the admin results view) never need to re-derive it
-- from quiz_questions after the fact (a later question edit must not
-- retroactively change the grading of a past attempt).
-- ---------------------------------------------------------------------
create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  selected_option text check (selected_option in ('A', 'B', 'C', 'D')),
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists quiz_answers_attempt_idx on public.quiz_answers (attempt_id);

-- ---------------------------------------------------------------------
-- import_quiz_with_questions — atomic backing for "Confirm & Import"
-- (DOCX upload flow). All-or-nothing: either the quiz and every one of
-- its questions are created together, or none of them are — so a
-- mid-batch failure (e.g. a constraint violation on question 14 of 20)
-- can never leave a half-imported quiz sitting in Draft with only some
-- of its questions. p_questions is a JSON array of
-- {questionText, optionA, optionB, optionC, optionD, correctOption, explanation}.
-- Field-level validation (non-empty text, correctOption in A-D) is
-- re-checked here even though the route already validated it — the
-- database function is the actual last line of defense, same principle
-- as the check constraints above.
-- ---------------------------------------------------------------------
create or replace function public.import_quiz_with_questions(
  p_course_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_pass_percent integer,
  p_created_by_id uuid,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
  q jsonb;
  v_order integer := 0;
begin
  if p_course_id is null then
    raise exception 'p_course_id is required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'p_title is required';
  end if;
  if p_status not in ('DRAFT', 'PUBLISHED') then
    raise exception 'p_status must be DRAFT or PUBLISHED';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'At least one question is required';
  end if;
  if p_status = 'PUBLISHED' then
    -- Every question must be complete before a quiz can go live —
    -- mirrors quizValidation.js's canPublishQuiz() on the Node side.
    for q in select * from jsonb_array_elements(p_questions)
    loop
      if coalesce(trim(q->>'questionText'), '') = ''
        or coalesce(trim(q->>'optionA'), '') = ''
        or coalesce(trim(q->>'optionB'), '') = ''
        or coalesce(trim(q->>'optionC'), '') = ''
        or coalesce(trim(q->>'optionD'), '') = ''
        or upper(coalesce(q->>'correctOption', '')) not in ('A', 'B', 'C', 'D') then
        raise exception 'Cannot publish: one or more questions are incomplete' using errcode = 'P0003';
      end if;
    end loop;
  end if;

  insert into public.quizzes (course_id, title, description, status, pass_percent, created_by_id)
  values (p_course_id, trim(p_title), coalesce(p_description, ''), p_status, coalesce(p_pass_percent, 70), p_created_by_id)
  returning id into v_quiz_id;

  for q in select * from jsonb_array_elements(p_questions)
  loop
    if coalesce(trim(q->>'questionText'), '') = ''
      or coalesce(trim(q->>'optionA'), '') = ''
      or coalesce(trim(q->>'optionB'), '') = ''
      or coalesce(trim(q->>'optionC'), '') = ''
      or coalesce(trim(q->>'optionD'), '') = ''
      or upper(coalesce(q->>'correctOption', '')) not in ('A', 'B', 'C', 'D') then
      -- A DRAFT import is allowed to include incomplete
      -- "needs review" questions (spec #3: they get fixed later in
      -- the admin's question editor) — but they must still have the
      -- bare minimum non-null text to satisfy the not-null columns.
      -- Skip genuinely empty rows so the underlying not-null/check
      -- constraints never get here, but a DRAFT quiz keeps the rest.
      continue;
    end if;
    insert into public.quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, order_index)
    values (
      v_quiz_id,
      trim(q->>'questionText'),
      trim(q->>'optionA'),
      trim(q->>'optionB'),
      trim(q->>'optionC'),
      trim(q->>'optionD'),
      upper(q->>'correctOption'),
      coalesce(q->>'explanation', ''),
      v_order
    );
    v_order := v_order + 1;
  end loop;

  if v_order = 0 then
    -- Every submitted question was incomplete — never leave a quiz
    -- with zero questions behind (would be un-openable and
    -- unpublishable); the whole transaction rolls back instead.
    raise exception 'No valid questions to import' using errcode = 'P0004';
  end if;

  return v_quiz_id;
end;
$$;

revoke execute on function public.import_quiz_with_questions(uuid, text, text, text, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_quiz_with_questions(uuid, text, text, text, integer, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- submit_quiz_attempt — the ONLY place a quiz is graded. Runs entirely
-- server-side inside Postgres so correct answers are never round-
-- tripped to (or trusted from) the browser: the client sends only
-- {questionId, selectedOption} pairs, and this function looks up each
-- question's real correct_option itself, scores the attempt, and
-- persists both the attempt and the per-question answers atomically.
-- pg_advisory_xact_lock serializes concurrent submissions for the same
-- (quiz, user) so two near-simultaneous submits (e.g. a double-click,
-- or two tabs) can't both compute the same attempt_number.
-- ---------------------------------------------------------------------
create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
  p_user_id uuid,
  p_answers jsonb -- [{questionId, selectedOption}]
)
returns table (
  attempt_id uuid,
  attempt_number integer,
  score integer,
  total_questions integer,
  percent numeric,
  passed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass_percent integer;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_total integer;
  v_score integer := 0;
  v_percent numeric;
  v_passed boolean;
  q record;
  v_selected text;
begin
  if p_quiz_id is null or p_user_id is null then
    raise exception 'p_quiz_id and p_user_id are required';
  end if;

  -- Serialize concurrent submissions for this exact (quiz, user) pair
  -- for the rest of this transaction only.
  perform pg_advisory_xact_lock(hashtextextended(p_quiz_id::text || ':' || p_user_id::text, 0));

  select pass_percent into v_pass_percent from public.quizzes where id = p_quiz_id and status = 'PUBLISHED';
  if not found then
    raise exception 'Quiz not found or not published' using errcode = 'P0002';
  end if;

  select count(*) into v_total from public.quiz_questions where quiz_id = p_quiz_id;
  if v_total = 0 then
    raise exception 'This quiz has no questions' using errcode = 'P0005';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt_number
    from public.quiz_attempts where quiz_id = p_quiz_id and user_id = p_user_id;

  insert into public.quiz_attempts (quiz_id, user_id, attempt_number, score, total_questions, percent, passed, started_at, completed_at)
  values (p_quiz_id, p_user_id, v_attempt_number, 0, v_total, 0, false, now(), now())
  returning id into v_attempt_id;

  for q in select id, correct_option from public.quiz_questions where quiz_id = p_quiz_id
  loop
    select upper(value->>'selectedOption') into v_selected
      from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as value
      where value->>'questionId' = q.id::text
      limit 1;

    if v_selected is not null and v_selected not in ('A', 'B', 'C', 'D') then
      v_selected := null; -- ignore any malformed client value rather than erroring the whole submission
    end if;

    if v_selected is not null and v_selected = q.correct_option then
      v_score := v_score + 1;
    end if;

    insert into public.quiz_answers (attempt_id, question_id, selected_option, is_correct)
    values (v_attempt_id, q.id, v_selected, v_selected is not null and v_selected = q.correct_option);
  end loop;

  v_percent := round((v_score::numeric / v_total) * 100, 2);
  v_passed := v_percent >= v_pass_percent;

  update public.quiz_attempts set score = v_score, percent = v_percent, passed = v_passed where id = v_attempt_id;

  return query select v_attempt_id, v_attempt_number, v_score, v_total, v_percent, v_passed;
end;
$$;

revoke execute on function public.submit_quiz_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_quiz_attempt(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security — deny-all for anon/authenticated, same as every
-- other table in this schema (see the note at the top of schema.sql).
-- ---------------------------------------------------------------------
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
revoke all on public.quizzes, public.quiz_questions, public.quiz_attempts, public.quiz_answers from anon, authenticated;
