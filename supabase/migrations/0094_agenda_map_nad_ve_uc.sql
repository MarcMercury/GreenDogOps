-- ============================================================================
-- Green Dog Ops — 0094 Agenda mapping → NAD/VE/UC
-- ----------------------------------------------------------------------------
-- The "Clinic/Wellness/UC" department was removed and "NAD" was renamed to
-- "NAD/VE/UC". Every ezyVet Agenda resource that previously counted as Clinic
-- (the general/no-department calendar plus UV / 2 DVM UV) — and the catch-all
-- default — now counts under NAD/VE/UC. The on-delete rules had NULLed those
-- mapping rows, so re-point them here.
-- ============================================================================
set search_path = greendogops, public;

update greendogops.ezyvet_agenda_dept_map m
set department_id = d.id
from greendogops.sched_department d
where d.name = 'NAD/VE/UC'
  and m.is_ignored = false
  and m.ezyvet_label in ('', '*', 'UV', '2 DVM UV');

-- Repoint any existing count rows that were left on a now-missing department to
-- NAD/VE/UC as well (safe: nothing currently maps to NAD/VE/UC so no unique
-- collision). Rows whose department was cascade-deleted are rebuilt on the next
-- Agenda ingest.
update greendogops.ezyvet_agenda_count c
set department_id = d.id
from greendogops.sched_department d
where d.name = 'NAD/VE/UC'
  and not exists (
    select 1 from greendogops.sched_department x where x.id = c.department_id
  );
