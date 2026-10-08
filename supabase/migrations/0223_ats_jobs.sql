-- ============================================================================
-- Green Dog Ops — 0223 Recruiting: Jobs you open and close, candidates linked
-- ----------------------------------------------------------------------------
-- The "Open Positions" board becomes "Jobs", managed like Indeed for
-- employers: a job is Open or Closed, candidates are linked to one job
-- (person_recruiting.target_position_id), and closing a job never removes its
-- candidates — they stay in All Candidates and can be reassigned.
--
--   1. position.status collapses to open | closed. The old on_hold / filled
--      statuses become a close_reason, and opened_at / closed_at record when
--      the job was last opened and closed.
--   2. Stages follow the team workflow doc:
--      New Lead → Contacted → Phone Screen → Interview → Shadow Day → Offer → Hired
--      ("Zoom/Virtual Interview" and "Interviewed" → Interview,
--       "In-Person / Shadow Day" → Shadow Day).
--   3. Candidates still in play (review queue + active stages) whose free-text
--      position and clinic match exactly one open job are linked to it. The
--      same title + clinic rule links new applicants as they arrive
--      (src/lib/ats/jobs.ts).
--
-- The position table stays shared with HR (person_employment.position_id), so
-- jobs are closed, never deleted, once anyone is linked.
-- updated_at is left untouched: this is not a recruiter edit.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- 1. Open / closed jobs
-- ---------------------------------------------------------------------------
alter table position
  add column if not exists opened_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists close_reason text;

-- updated_at stays the job's last real edit, which becomes closed_at below.
alter table position disable trigger set_updated_at;

update position set opened_at = created_at where opened_at is null;

update position
set close_reason = case status
      when 'filled' then 'filled'
      when 'on_hold' then 'on_hold'
      else close_reason
    end,
    closed_at = coalesce(closed_at, updated_at, now()),
    status = 'closed'
where status in ('filled', 'on_hold', 'closed') and closed_at is null;

alter table position enable trigger set_updated_at;

alter table position
  alter column opened_at set default now(),
  alter column opened_at set not null,
  drop constraint if exists position_status_check,
  add constraint position_status_check check (status in ('open', 'closed')),
  drop constraint if exists position_close_reason_check,
  add constraint position_close_reason_check
    check (close_reason is null or close_reason in ('filled', 'cancelled', 'on_hold'));

comment on column position.status is 'open | closed (recruiting job status)';
comment on column position.opened_at is 'When the job was last opened (reopening resets it)';
comment on column position.closed_at is 'When the job was closed; null while open';
comment on column position.close_reason is 'filled | cancelled | on_hold — why a closed job was closed';

-- ---------------------------------------------------------------------------
-- 2. Stage names from the workflow doc
-- ---------------------------------------------------------------------------
alter table person_recruiting disable trigger set_updated_at;

update person_recruiting
set stage = 'Interview'
where stage in ('Zoom/Virtual Interview', 'Interviewed');

update person_recruiting
set stage = 'Shadow Day'
where stage = 'In-Person / Shadow Day';

-- ---------------------------------------------------------------------------
-- 3. Link in-play candidates to the one open job they clearly applied for
-- ---------------------------------------------------------------------------
with cand as (
  select r.person_id,
         lower(btrim(r.target_title)) as title,
         lower(btrim(r.job_location)) as loc
  from person_recruiting r
  join person p on p.id = r.person_id
  where p.status = 'applicant'
    and r.target_position_id is null
    and r.target_title is not null
    and (
      r.review_status = 'pending'
      or (
        r.review_status = 'accepted'
        and r.stage in ('New Lead', 'Contacted', 'Phone Screen', 'Interview',
                        'Shadow Day', 'Offer', 'Decision Needed')
      )
    )
),
matches as (
  select c.person_id, j.id as position_id
  from cand c
  join position j
    on j.status = 'open'
   and lower(btrim(j.title)) = c.title
   and (c.loc is null or j.location is null or lower(btrim(j.location)) = c.loc)
),
unique_match as (
  select person_id, (array_agg(position_id))[1] as position_id
  from matches
  group by person_id
  having count(*) = 1
)
update person_recruiting r
set target_position_id = u.position_id
from unique_match u
where r.person_id = u.person_id;

alter table person_recruiting enable trigger set_updated_at;

commit;
