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
