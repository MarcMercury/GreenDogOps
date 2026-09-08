-- ============================================================================
-- 0171 — Clear grid_name values that belong to a different employee
--
-- The HR workbook has "Rachel Moreno" with GRID NAME = "Raquel Romero" — the
-- name of a DIFFERENT current employee (both are Vet Assistants; looks like a
-- dragged cell). grid_name is a person identifier used for name matching, and
-- lib/hr/wheniwork.ts builds its lookup with `idx.set(key, id)`, so a shared
-- key is silently won by whichever row is processed last. A When I Work PTO
-- request for one of them could be filed against the other.
--
-- Clears grid_name when it matches ANOTHER employee/contractor's full name and
-- is not the person's own name. Raquel Romero keeps hers (it equals her own
-- full name), and Olivia Guerra keeps "Olivia Saenz" (that collides only with
-- an applicant row, and HR set it deliberately — she goes by Saenz on the
-- schedule).
--
-- scripts/reconcile_hr_roster.mjs will no longer re-apply a colliding GRID NAME
-- from the sheet, so this cannot silently come back. The sheet itself still
-- needs the cell corrected.
-- ============================================================================

update greendogops.person a
   set grid_name = null,
       notes = nullif(trim(both E'\n' from
                 coalesce(a.notes, '')
                 || E'\n\nGRID NAME "' || a.grid_name || '" cleared '
                 || to_char(now(), 'YYYY-MM-DD')
                 || ': it is another employee''s name (see the HR sheet).'), ''),
       updated_at = now()
 where coalesce(btrim(a.grid_name), '') <> ''
   and a.status in ('employee', 'contractor')
   and lower(btrim(a.grid_name)) is distinct from lower(btrim(coalesce(a.full_name, '')))
   and exists (
     select 1
     from greendogops.person b
     where b.id <> a.id
       and b.status in ('employee', 'contractor')
       and lower(btrim(coalesce(b.full_name, ''))) = lower(btrim(a.grid_name))
   );
