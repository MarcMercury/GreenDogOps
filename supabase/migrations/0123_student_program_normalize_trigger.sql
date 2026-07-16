-- ============================================================================
-- Green Dog Ops — 0123 Student program normalization trigger
-- ----------------------------------------------------------------------------
-- The Student CRM "Program" is `program_name ?? program_type`. Legacy grid
-- imports (scripts/import_students.py) dump the workbook "Type" column straight
-- into `program_type`, so raw labels like "SAP III/IV 3 weeks",
-- "SAPP Avail / Split for holiday", "Externship 4wk Dentistry",
-- "Western Extern iii" and "Dentistry Rotation 4th year" keep reappearing after
-- every re-import — undoing the one-off 0120–0122 data fixes.
--
-- This installs a BEFORE INSERT/UPDATE trigger that normalizes the four managed
-- program families on EVERY write, so the split survives any import path:
--
--     SAP* / SAPP*        -> Program "SAP"
--     Externship*         -> Program "Externship"
--     Western Extern*     -> Program "Western Extern"
--     Dentistry Rotation* -> Program "Dentistry Rotation"
--
-- with the text after the prefix moved into `program_subcategory`. Anything
-- else (e.g. "CVM 7070 Dentistry Rotation", "Internal Medicine Rotation") is
-- left untouched, and the lowercase `program_type` classification values
-- (externship / paid_cohort / internship / ...) are never treated as labels.
-- ============================================================================

-- Split a raw program label into (canonical name, remainder subcategory).
-- Returns NULLs when the label is not one of the four managed families.
-- SAPP is checked before SAP so it never yields a "P …" remainder.
create or replace function greendogops.split_student_program(label text)
returns table(pname text, psub text)
language sql
immutable
as $$
  select
    case
      when label ~* '^SAPP'               then 'SAP'
      when label ~* '^SAP'                then 'SAP'
      when label ~* '^Western Extern'     then 'Western Extern'
      when label ~* '^Externship'         then 'Externship'
      when label ~* '^Dentistry Rotation' then 'Dentistry Rotation'
    end,
    nullif(btrim(
      case
        when label ~* '^SAPP'               then substr(label, 5)
        when label ~* '^SAP'                then substr(label, 4)
        when label ~* '^Western Extern'     then substr(label, 15)
        when label ~* '^Externship'         then substr(label, 11)
        when label ~* '^Dentistry Rotation' then substr(label, 19)
      end
    ), '');
$$;

create or replace function greendogops.normalize_student_program()
returns trigger
language plpgsql
as $$
declare
  np text;
  ns text;
begin
  if new.contact_type is distinct from 'student' then
    return new;
  end if;

  -- (a) A managed label parked in program_type while program_name is empty
  --     (legacy grid import): promote it. Bare lowercase classification tokens
  --     such as 'externship' / 'paid_cohort' are NOT labels, so skip them.
  if nullif(btrim(new.program_name), '') is null
     and new.program_type is not null
     and new.program_type !~ '^[a-z_]+$' then
    select s.pname, s.psub into np, ns
      from greendogops.split_student_program(new.program_type) s;
    if np is not null then
      new.program_name := np;
      new.program_subcategory :=
        coalesce(ns, nullif(btrim(new.program_subcategory), ''));
      new.program_type := null;
      return new;
    end if;
  end if;

  -- (b) A managed prefix stored directly in program_name WITH trailing text:
  --     split it into canonical name + subcategory.
  if nullif(btrim(new.program_name), '') is not null then
    select s.pname, s.psub into np, ns
      from greendogops.split_student_program(new.program_name) s;
    if np is not null and btrim(new.program_name) <> np then
      new.program_name := np;
      new.program_subcategory :=
        coalesce(ns, nullif(btrim(new.program_subcategory), ''));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_student_program on greendogops.crm_contact;
create trigger trg_normalize_student_program
  before insert or update on greendogops.crm_contact
  for each row
  execute function greendogops.normalize_student_program();

-- Backfill: touch every student row so the trigger normalizes existing data.
update greendogops.crm_contact
set program_type = program_type
where contact_type = 'student';
