-- ============================================================================
-- Green Dog Ops — 0067 Planning guide week scope + capacity-rule seed
-- ----------------------------------------------------------------------------
-- Two related changes that close the Schedule → Daily Capacity → Planning loop:
--
--   1. Planning guides can now be auto-generated for a specific schedule week
--      from a Daily Capacity tile. `source_week_id` records the week a guide was
--      generated for (NULL = a reusable template that shows on every week);
--      `auto_generated` flags machine-built guides; `target_appointments` keeps
--      the appointment count the guide was sized to (the tile's capacity number).
--
--   2. Seed `planning_capacity_rule` from the existing hand-authored guides so
--      the Daily Capacity grid immediately suggests appointment counts from the
--      staffing already scheduled. One rule per active guide, keyed by the same
--      location / area / staffing signature / weekdays, with capacity = that
--      guide's bookable-slot count. Guarded so re-runs never duplicate a rule.
-- ============================================================================
set search_path = greendogops, public;

-- 1. Week scoping on planning_guide -----------------------------------------
alter table greendogops.planning_guide
  add column if not exists source_week_id uuid
    references greendogops.sched_week (id) on delete set null,
  add column if not exists auto_generated boolean not null default false,
  add column if not exists target_appointments int;

create index if not exists planning_guide_source_week_idx
  on greendogops.planning_guide (source_week_id);

comment on column greendogops.planning_guide.source_week_id is
  'Schedule week this guide was auto-generated for; NULL = reusable template shown on every week.';
comment on column greendogops.planning_guide.auto_generated is
  'True when the guide was auto-generated from a Daily Capacity tile.';
comment on column greendogops.planning_guide.target_appointments is
  'Appointment count the auto-generated guide was sized to (the matched capacity rule number).';

-- 2. Seed capacity rules from existing active guides ------------------------
insert into greendogops.planning_capacity_rule
  (location_id, department_id, label, weekdays,
   dvm_count, tech_count, lead_count, dental_count, da_count, float_count,
   appointment_capacity, status, sort_order)
select g.location_id,
       g.department_id,
       g.name,
       g.weekdays,
       g.dvm_count, g.tech_count, g.lead_count,
       g.dental_count, g.da_count, g.float_count,
       coalesce(b.bookable, 0),
       'active',
       g.sort_order
from greendogops.planning_guide g
left join (
  select guide_id, count(*) as bookable
  from greendogops.planning_guide_slot
  where type_code not in ('open', 'block', 'lunch')
  group by guide_id
) b on b.guide_id = g.id
where g.status = 'active'
  and g.department_id is not null
  and not exists (
    select 1
    from greendogops.planning_capacity_rule r
    where r.department_id = g.department_id
      and r.location_id   is not distinct from g.location_id
      and r.weekdays      = g.weekdays
      and r.dvm_count     is not distinct from g.dvm_count
      and r.tech_count    is not distinct from g.tech_count
      and r.lead_count    is not distinct from g.lead_count
      and r.dental_count  is not distinct from g.dental_count
      and r.da_count      is not distinct from g.da_count
      and r.float_count   is not distinct from g.float_count
  );
