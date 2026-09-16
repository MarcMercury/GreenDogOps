-- 0188: Normalize duplicate roster job titles.
--
-- Roster titles were hand-typed and imported from several spreadsheets, so the
-- same role appears under many spellings ("Vet Assistant" vs "Veterinary
-- Assistant", "Remote Admin" vs "Remote Administrator", trailing spaces, a
-- stray "Remote CSR?"). That splits the HR > Title filter into duplicate rows.
--
-- House style: Vet -> Veterinary, Tech -> Technician, Admin -> Administrator.
-- The TS mirror of this map lives in src/lib/hr/job-titles.ts and runs on every
-- app write path (profile form, inline grid edit, roster file import).

create or replace function greendogops.normalize_job_title(raw text)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select a.canonical
        from (values
          -- Veterinary support staff
          ('vet assistant',                       'Veterinary Assistant'),
          ('vet asst',                            'Veterinary Assistant'),
          ('veterinary assistant',                'Veterinary Assistant'),
          ('vet assistant trainee',               'Veterinary Assistant Trainee'),
          ('veterinary assistant trainee',        'Veterinary Assistant Trainee'),
          ('vet tech',                            'Veterinary Technician'),
          ('vet technician',                      'Veterinary Technician'),
          ('veterinary tech',                     'Veterinary Technician'),
          ('veterinary technician',               'Veterinary Technician'),
          ('dental tech',                         'Dental Technician'),
          ('dental technician',                   'Dental Technician'),
          ('lead clinical tech',                  'Lead Clinical Technician'),
          ('lead clinical technician',            'Lead Clinical Technician'),
          ('registered vet tech',                 'RVT'),
          ('registered vet technician',           'RVT'),
          ('registered veterinary tech',          'RVT'),
          ('registered veterinary technician',    'RVT'),
          ('registered veterinary technician rvt','RVT'),
          ('rvt',                                 'RVT'),
          -- Doctors
          ('dvm',                                 'DVM'),
          ('doctor of veterinary medicine',       'DVM'),
          ('relief vet',                          'Relief DVM'),
          ('relief dvm',                          'Relief DVM'),
          ('relief veterinarian',                 'Relief DVM'),
          ('opthamologist',                       'Ophthalmologist'),
          ('ophthalmologist',                     'Ophthalmologist'),
          -- Interns / students
          ('vet intern',                          'Veterinary Intern'),
          ('veterinary intern',                   'Veterinary Intern'),
          ('foreign vet graduate intern',         'Foreign Veterinary Graduate Intern'),
          ('foreign veterinary graduate intern',  'Foreign Veterinary Graduate Intern'),
          ('foreign veterinary graduate internship','Foreign Veterinary Graduate Intern'),
          -- Client service
          ('csr',                                 'CSR'),
          ('csr lead',                            'CSR Lead'),
          ('rcsr',                                'RCSR'),
          ('in house csr',                        'In-House CSR'),
          ('remote csr',                          'Remote CSR'),
          ('remote csr manager',                  'Remote CSR Manager'),
          ('remote csr admin',                    'Remote CSR / Administrator'),
          -- Administration
          ('remote admin',                        'Remote Administrator'),
          ('remote administration',               'Remote Administrator'),
          ('remote administrator',                'Remote Administrator'),
          ('in house admin',                      'In-House Administrator'),
          ('in house administration',             'In-House Administrator'),
          ('in house administrator',              'In-House Administrator'),
          ('my pet admin',                        'My Pet Administrator'),
          ('my pet administration',               'My Pet Administrator'),
          ('my pet administrator',                'My Pet Administrator'),
          ('mp truck admin',                      'MP Truck Administrator'),
          ('mp truck administrator',              'MP Truck Administrator'),
          -- Leadership
          ('coo',                                 'COO'),
          ('chief operations officer',            'COO'),
          ('cfo',                                 'CFO'),
          ('chief financial officer',             'CFO'),
          ('cmo',                                 'CMO'),
          ('chief marketing officer',             'CMO'),
          ('cco',                                 'CCO'),
          ('chief culture officer',               'CCO')
        ) as a(key, canonical)
        -- Match on a punctuation-free lookup key so hyphen/casing/"?" variants
        -- ("In-House CSR", "in house csr", "Remote CSR?") collapse to one entry.
       where a.key = btrim(regexp_replace(lower(raw), '[^a-z0-9]+', ' ', 'g'))
       limit 1
    ),
    -- Unknown titles: keep the text, just trim and collapse inner whitespace.
    nullif(btrim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g')), '')
  );
$$;

update greendogops.person_employment
   set adp_job_title = greendogops.normalize_job_title(adp_job_title),
       offer_title   = greendogops.normalize_job_title(offer_title)
 where adp_job_title is distinct from greendogops.normalize_job_title(adp_job_title)
    or offer_title   is distinct from greendogops.normalize_job_title(offer_title);
