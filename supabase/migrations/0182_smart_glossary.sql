-- ============================================================================
-- Green Dog Ops — 0182 Smart Report: shared business glossary
-- ----------------------------------------------------------------------------
-- Verified examples (0181) teach Smart Report whole QUESTIONS. This teaches it
-- the practice's VOCABULARY: what a phrase means, and how to express it in SQL.
-- "Expiring wellness plan" = term_start_date + 1 year. "Production" = credited
-- to the case owner, falling back to the staff member. Until now every one of
-- those rules had to be hand-written into DOMAIN_NOTES in the codebase.
--
-- Nobody has bandwidth to sit down and author a glossary, so entries arrive two
-- ways:
--   * anyone with Reporting edit rights adds or corrects one (status 'active')
--   * the system DRAFTS them from the question log — recurring phrasings and
--     questions that failed or needed retries — for an admin to accept, edit or
--     reject in one click (status 'draft')
--
-- `aliases` is what makes it robust to how people actually type: "expiring",
-- "renewing" and "lapsing" can all point at the same rule.
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.smart_glossary (
  id          uuid primary key default gen_random_uuid(),
  term        text not null,
  -- Other ways the team phrases the same thing.
  aliases     text[] not null default '{}',
  -- Plain English: what this means in the business.
  definition  text not null,
  -- Optional: the canonical tables/filters/SQL fragment that expresses it.
  sql_hint    text,
  status      text not null default 'active'
                check (status in ('draft', 'active', 'archived')),
  source      text not null default 'manual'
                check (source in ('manual', 'suggested')),
  -- Set on a suggestion so a reviewer can see what prompted it.
  source_note text,
  created_by  uuid references greendogops.app_user (id) on delete set null,
  updated_by  uuid references greendogops.app_user (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table greendogops.smart_glossary is
  'Shared business vocabulary for Smart Report: a phrase, the other ways people say it, what it means and how to express it in SQL. Matched terms are injected into the prompt.';

create unique index if not exists smart_glossary_term_key
  on greendogops.smart_glossary (lower(term));
create index if not exists smart_glossary_status_idx
  on greendogops.smart_glossary (status, term);

drop trigger if exists set_updated_at on greendogops.smart_glossary;
create trigger set_updated_at before update on greendogops.smart_glossary
  for each row execute function greendogops.set_updated_at();

revoke all on greendogops.smart_glossary from public, anon, authenticated;
grant select, insert, update, delete on greendogops.smart_glossary to service_role;

-- ---------------------------------------------------------------------------
-- The active glossary entries whose term or any alias appears in the question.
-- Whole-word match so "plan" does not fire on "planning", with an optional
-- plural so "expiring wellness plans" still matches the singular term. The
-- phrase is regex-escaped because terms are free text.
-- ---------------------------------------------------------------------------
create or replace function greendogops.smart_glossary_for(
  p_question text,
  p_limit    integer default 8
)
returns table (term text, definition text, sql_hint text)
language sql
stable
security definer
set search_path to 'greendogops', 'public', 'pg_temp'
as $function$
  with phrases as (
    select g.id, g.term, g.definition, g.sql_hint,
           unnest(array_prepend(g.term, g.aliases)) as phrase
    from greendogops.smart_glossary g
    where g.status = 'active'
  )
  select distinct on (p.id) p.term, p.definition, p.sql_hint
  from phrases p
  where coalesce(p_question, '') ~*
        ('\m' || regexp_replace(p.phrase, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(s|es)?\M')
  order by p.id, length(p.phrase) desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$function$;

revoke all on function greendogops.smart_glossary_for(text, integer) from public, anon, authenticated;
grant execute on function greendogops.smart_glossary_for(text, integer) to service_role;

comment on function greendogops.smart_glossary_for(text, integer) is
  'Glossary entries whose term or alias appears in a question, for injection into the Smart Report prompt.';

-- ---------------------------------------------------------------------------
-- Seed the rules that were previously hard-coded prose, so the team can correct
-- them in the UI instead of asking an engineer to edit the prompt.
-- ---------------------------------------------------------------------------
insert into greendogops.smart_glossary (term, aliases, definition, sql_hint)
values
  ('expiring wellness plan',
   array['expiring plan','renewing wellness plan','plan renewal','lapsing plan','wellness plan expiry'],
   'A Green Dog Plus term runs one year from term_start_date, so a plan expires (renews) on term_start_date + 1 year. There is no expiry column. Expiry is per PET, and a pet can hold benefit rows from more than one term.',
   'with per_pet as (select pet_code, max(pet_name) as pet_name, max(customer_name) as owner_name, max(term_start_date) as term_start from report_wellness_plan_current group by pet_code) select pet_name, owner_name, (term_start + interval ''1 year'')::date as renews_on from per_pet'),
  ('production',
   array['doctor production','provider production','doctor revenue','vet revenue'],
   'Revenue credited to the case-owning doctor, falling back to the staff member when the line has no case owner. Around 2,000 lines a month have no case owner, so grouping on case_owner alone drops roughly $180k a month.',
   'group by coalesce(nullif(case_owner,''''), nullif(staff_member,'''')) -- or use report_by_case_owner / report_case_owner_by_month'),
  ('booked appointments',
   array['booked','on the board','scheduled appointments','upcoming appointments','appointments booked'],
   'Appointments on the live ezyVet book, including today and future dates. The ezyvet_appointment matview only covers billed, rendered visits and will wrongly report zero for these.',
   'select location_name, sum(expected_count) as booked from appointment_review(<start>, <end>) group by location_name'),
  ('member',
   array['wellness plan member','plan member','gdd+ member','green dog plus member'],
   'A client on the wellness plan: count(distinct customer_code) over report_wellness_plan_current. An enrolled PET is count(distinct pet_code) and there are more pets than members. Never count rows — each row is one benefit.',
   'select count(distinct customer_code) as member_count from report_wellness_plan_current')
on conflict (lower(term)) do nothing;
