-- ============================================================================
-- Green Dog Ops — 0181 Smart Report: question log + learning from verified answers
-- ----------------------------------------------------------------------------
-- Two things Smart Report could not do before:
--   1. Remember. Conversation context lived in React state, so a page reload
--      wiped it and nobody (not even the asker) could see what they had asked.
--   2. Improve. Every accuracy fix meant hand-editing DOMAIN_NOTES in code.
--
-- smart_question_log records every question with the SQL it produced and how it
-- went. That is the private session history AND the raw material for learning.
--
-- An answer an ADMIN confirms is correct (verified = true) becomes a worked
-- example: smart_examples() returns the closest verified question/SQL pairs for
-- a new question, and they go into the prompt as few-shot guidance. Only
-- human-verified rows are ever fed back — reinforcing a query that merely ran
-- without error would teach the model its own mistakes.
--
-- Deliberately NOT stored: the result rows. They are re-run on demand, so the
-- log never becomes a stale copy of client PII.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.smart_question_log (
  id            uuid primary key default gen_random_uuid(),
  app_user_id   uuid references greendogops.app_user (id) on delete set null,
  user_email    text,
  user_role     text,
  question      text not null,
  sql           text,
  ok            boolean not null default false,
  row_count     integer not null default 0,
  answer        text,
  error         text,
  -- Failed drafts from the retry loop: [{sql, error}, ...]. Shows WHERE the
  -- model struggles, which is what tells you the next rule worth writing.
  attempts      jsonb not null default '[]'::jsonb,
  provider      text,
  duration_ms   integer,
  -- 1 = thumbs up, -1 = thumbs down, null = not rated.
  feedback      smallint,
  feedback_note text,
  -- Only an admin thumbs-up sets this; it is the gate on the learning loop.
  verified      boolean not null default false,
  verified_by   uuid references greendogops.app_user (id) on delete set null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint smart_question_log_feedback_ck check (feedback is null or feedback in (-1, 1))
);

comment on table greendogops.smart_question_log is
  'Every Smart Report question: the SQL it produced, how it went, and whether a human confirmed the answer. Private history per user; verified rows train the prompt.';

create index if not exists smart_question_log_user_idx
  on greendogops.smart_question_log (app_user_id, created_at desc);
create index if not exists smart_question_log_created_idx
  on greendogops.smart_question_log (created_at desc);
-- Verified examples are looked up by text similarity on the question.
create index if not exists smart_question_log_verified_idx
  on greendogops.smart_question_log using gin (to_tsvector('english', question))
  where verified;

-- Service-role only, like the rest of the Smart Report plumbing. Access is
-- gated in the server actions (a user may only read their own rows).
revoke all on greendogops.smart_question_log from public, anon, authenticated;
grant select, insert, update on greendogops.smart_question_log to service_role;

-- ---------------------------------------------------------------------------
-- The closest verified question/SQL pairs for a new question. Ranked by
-- full-text match, newest first when scores tie.
-- ---------------------------------------------------------------------------
create or replace function greendogops.smart_examples(
  p_question text,
  p_limit    integer default 3
)
returns table (question text, sql text, rank real)
language sql
stable
security definer
set search_path to 'greendogops', 'public', 'pg_temp'
as $function$
  select l.question,
         l.sql,
         ts_rank(to_tsvector('english', l.question),
                 websearch_to_tsquery('english', p_question)) as rank
  from greendogops.smart_question_log l
  where l.verified
    and l.sql is not null
    and to_tsvector('english', l.question) @@ websearch_to_tsquery('english', p_question)
  order by rank desc, l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$function$;

revoke all on function greendogops.smart_examples(text, integer) from public, anon, authenticated;
grant execute on function greendogops.smart_examples(text, integer) to service_role;

comment on function greendogops.smart_examples(text, integer) is
  'Verified question/SQL pairs closest to a new question, used as few-shot examples in the Smart Report prompt.';
