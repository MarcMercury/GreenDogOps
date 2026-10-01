-- ============================================================================
-- Green Dog Ops — 0214 Allow more than one week template
-- ----------------------------------------------------------------------------
-- Templates are stored as sched_week rows flagged is_template, parked on a
-- sentinel week_start. Two indexes made exactly one of them possible:
--
--   sched_week_single_template  unique (is_template) where is_template
--       Literally permits a single template row.
--
--   sched_week_start_idx        unique (week_start)
--       Less obvious: every template occupies the same sentinel date, so a
--       second one collides here even once the first index is gone.
--
-- Real weeks still need a unique week_start -- two grids for the same Monday
-- would be a genuine bug -- so that index becomes partial rather than being
-- dropped.
-- ============================================================================
set search_path = greendogops, public;

drop index if exists greendogops.sched_week_single_template;

drop index if exists greendogops.sched_week_start_idx;
create unique index sched_week_start_idx
  on greendogops.sched_week (week_start)
  where not is_template;

-- Several templates are only usable if they can be told apart, so a name stops
-- being optional at the point there can be more than one.
update greendogops.sched_week
   set title = coalesce(nullif(btrim(title), ''), 'Week Template')
 where is_template;

alter table greendogops.sched_week
  drop constraint if exists sched_week_template_needs_title;
alter table greendogops.sched_week
  add constraint sched_week_template_needs_title
  check (not is_template or coalesce(btrim(title), '') <> '');

-- Case-insensitive: "Summer" and "summer" as two templates would only ever be
-- a mistake.
create unique index if not exists sched_week_template_title_idx
  on greendogops.sched_week (lower(btrim(title)))
  where is_template;
