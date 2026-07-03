-- 0066_dedupe_roster_ats_student.sql
--
-- De-duplicate people who exist on the Employee Roster AND in the ATS or the
-- Student CRM. The roster record is authoritative: any applicable data from the
-- duplicate is migrated onto the roster person, then the duplicate is deleted.
--
-- Systems:
--   Roster       = greendogops.person, status in (employee, contractor, former)
--   ATS          = greendogops.person, status = applicant   (a SEPARATE person row)
--   Student CRM  = greendogops.crm_contact, contact_type = 'student'
--
-- Matching: shared email (case/space-insensitive) OR exact full-name match.
-- Confirmed safe beforehand: the duplicate applicant rows are NOT referenced by
-- app_user, schedule, or promotion links; the 3 student duplicates have no CE
-- attendance rows. All changes run in one transaction.

BEGIN;

-- =====================================================================
-- Part A — ATS applicant duplicates of roster people
-- =====================================================================

CREATE TEMP TABLE _ats_dup ON COMMIT DROP AS
SELECT DISTINCT ON (a.id)
       a.id AS dup_id,
       r.id AS keep_id
FROM greendogops.person r
JOIN greendogops.person a
  ON a.id <> r.id
 AND a.status = 'applicant'
 AND (
      (nullif(lower(trim(r.email)), '') = nullif(lower(trim(a.email)), ''))
   OR (lower(trim(r.full_name)) = lower(trim(a.full_name)) AND coalesce(r.full_name, '') <> '')
 )
WHERE r.status IN ('employee', 'contractor', 'former')
ORDER BY a.id,
         CASE r.status WHEN 'employee' THEN 0 WHEN 'contractor' THEN 1 ELSE 2 END,
         r.updated_at DESC NULLS LAST;

-- 1. Fill roster contact gaps from the duplicate applicant (coalesce = only when blank).
UPDATE greendogops.person r
SET email             = coalesce(nullif(trim(r.email), ''), a.email),
    phone_mobile      = coalesce(nullif(trim(r.phone_mobile), ''), a.phone_mobile),
    phone_home        = coalesce(nullif(trim(r.phone_home), ''), a.phone_home),
    phone_other       = coalesce(nullif(trim(r.phone_other), ''), a.phone_other),
    source_contact_id = coalesce(r.source_contact_id, a.source_contact_id),
    updated_at        = now()
FROM _ats_dup m
JOIN greendogops.person a ON a.id = m.dup_id
WHERE r.id = m.keep_id;

-- 2. Re-point the ATS recruiting record (pipeline/stage/notes/resume/interview)
--    onto the roster person, but only when the roster person has none of its own
--    (person_recruiting is 1:1). This preserves the full recruiting history.
UPDATE greendogops.person_recruiting pr
SET person_id = m.keep_id
FROM _ats_dup m
WHERE pr.person_id = m.dup_id
  AND NOT EXISTS (
        SELECT 1 FROM greendogops.person_recruiting x WHERE x.person_id = m.keep_id
      );

-- 3. Re-point any multi-row ATS child records onto the roster person.
UPDATE greendogops.person_interview t SET person_id = m.keep_id FROM _ats_dup m WHERE t.person_id = m.dup_id;
UPDATE greendogops.person_document  t SET person_id = m.keep_id FROM _ats_dup m WHERE t.person_id = m.dup_id;
UPDATE greendogops.person_review    t SET person_id = m.keep_id FROM _ats_dup m WHERE t.person_id = m.dup_id;
UPDATE greendogops.person_license   t SET person_id = m.keep_id FROM _ats_dup m WHERE t.person_id = m.dup_id;
UPDATE greendogops.person_asset     t SET person_id = m.keep_id FROM _ats_dup m WHERE t.person_id = m.dup_id;

-- 4. Re-point any promotion links from the duplicate to the roster person.
UPDATE greendogops.crm_contact c
SET promoted_person_id = m.keep_id
FROM _ats_dup m
WHERE c.promoted_person_id = m.dup_id;

-- 5. Delete the duplicate applicant person rows (any leftover 1:1 child rows cascade).
DELETE FROM greendogops.person a USING _ats_dup m WHERE a.id = m.dup_id;

-- =====================================================================
-- Part B — Student CRM duplicates of roster people
-- =====================================================================

CREATE TEMP TABLE _student_dup ON COMMIT DROP AS
SELECT DISTINCT ON (c.id)
       c.id AS dup_id,
       r.id AS keep_id
FROM greendogops.person r
JOIN greendogops.crm_contact c
  ON c.contact_type = 'student'
 AND (
      (nullif(lower(trim(r.email)), '') = nullif(lower(trim(c.email)), ''))
   OR (lower(trim(r.full_name)) = lower(trim(c.full_name)) AND coalesce(r.full_name, '') <> '')
 )
WHERE r.status IN ('employee', 'contractor', 'former')
ORDER BY c.id,
         CASE r.status WHEN 'employee' THEN 0 WHEN 'contractor' THEN 1 ELSE 2 END,
         r.updated_at DESC NULLS LAST;

-- Migrate applicable student data onto the roster person: fill contact gaps and
-- preserve the program/school history in notes so nothing is lost on delete.
UPDATE greendogops.person r
SET email        = coalesce(nullif(trim(r.email), ''), c.email),
    phone_mobile = coalesce(nullif(trim(r.phone_mobile), ''), c.phone),
    notes = trim(BOTH E'\n' FROM
              coalesce(r.notes, '')
              || CASE WHEN coalesce(r.notes, '') <> '' THEN E'\n\n' ELSE '' END
              || 'Student CRM (merged ' || to_char(now(), 'YYYY-MM-DD') || '): '
              || concat_ws(' | ',
                   nullif('School: '    || coalesce(c.school, ''),                          'School: '),
                   nullif('Program: '   || coalesce(nullif(c.program_name, ''), c.program_type, ''), 'Program: '),
                   nullif('Grad year: ' || coalesce(c.grad_year, ''),                       'Grad year: '),
                   nullif('Status: '    || coalesce(c.status, ''),                          'Status: '),
                   nullif('Hours: '     || coalesce(c.hours_completed::text, ''),           'Hours: '),
                   nullif('Mentor: '    || coalesce(c.mentor, ''),                          'Mentor: ')
                 )),
    updated_at = now()
FROM _student_dup m
JOIN greendogops.crm_contact c ON c.id = m.dup_id
WHERE r.id = m.keep_id;

-- Delete the duplicate Student CRM records (person.source_contact_id -> SET NULL).
DELETE FROM greendogops.crm_contact c USING _student_dup m WHERE c.id = m.dup_id;

COMMIT;
