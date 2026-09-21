-- ---------------------------------------------------------------------------
-- 0203 — full-roster staff schedule sync
--
-- The nightly pull of the "GDD Staff Schedule 2026" sheet used to import only
-- the nine VET-* doctor rows, so ~87% of the sheet (techs, CSRs, DAs, remote)
-- never reached the Schedule grid. The importer now maps every role row, which
-- means it has to know which placements it owns: `sched_assignment.source`
-- marks the rows it rewrites on every run so hand-entered placements survive.
-- ---------------------------------------------------------------------------

alter table greendogops.sched_assignment
  add column if not exists source text;

comment on column greendogops.sched_assignment.source is
  'Origin of the placement. ''sheet'' = imported from the staff schedule Google Sheet and replaced on every nightly run; null = entered in the app.';

create index if not exists sched_assignment_source_idx
  on greendogops.sched_assignment (week_id, source);

-- Backfill. Until now apply_sheet_dvm_assignments() deleted and reinserted
-- every DVM-role assignment in each unpublished week, so those rows were
-- already sheet-owned in practice.
update greendogops.sched_assignment a
   set source = 'sheet'
  from greendogops.sched_week w,
       greendogops.sched_week_line l,
       greendogops.sched_role r
 where w.id = a.week_id
   and l.id = a.line_id
   and r.id = l.role_id
   and r.name = 'DVM'
   and a.source is null
   and w.status <> 'published'
   and coalesce(w.is_template, false) = false;

-- The schedule sheet writes "Dr. Habawel"; grid_name still held an older short
-- form that appears nowhere in the workbook, so every run filed ~39 placements
-- as unmatched instead of scheduling them.
update greendogops.person
   set grid_name = 'Dr. Habawel'
 where full_name = 'Dr. Candice Habawel';
