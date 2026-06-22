-- 0032_merge_ats_hired_duplicates.sql
--
-- Cleanup: 28 ATS "Hired" candidate rows (person.status='applicant') are
-- duplicates of an existing HR roster person (status employee/former). The HR
-- record is the source of truth. This migration:
--   1. Snapshots each ATS duplicate (person + person_recruiting) for reversal.
--   2. Re-points the ATS person_recruiting row onto the canonical HR person so
--      the recruiting history (notes / stage / resume) is preserved on the
--      roster record (verified: HR records have no existing recruiting row).
--   3. Deletes the now-empty ATS duplicate person row.
--
-- Out of scope: 64 other "Hired" ATS rows with no HR record (left as-is).
-- Decisions applied: Ashley Paredes -> active employee 449c5d7e; Regina Herrera
-- (stage "Seperated ( No Rehire )") removed from ATS.

begin;

-- 1. Backup table (reversibility). One row per ATS duplicate.
create table if not exists greendogops.ats_hr_merge_backup_0032 (
  ats_id          uuid primary key,
  emp_id          uuid not null,
  person_json     jsonb not null,
  recruiting_json jsonb,
  merged_at       timestamptz not null default now()
);

insert into greendogops.ats_hr_merge_backup_0032 (ats_id, emp_id, person_json, recruiting_json)
select v.ats_id, v.emp_id, to_jsonb(per.*), to_jsonb(rec.*)
from (values
  ('d19d2a93-3e2d-4125-b506-d6fa65b6f03d'::uuid, '86dccd55-72f6-4190-b853-7317e1b386f7'::uuid), -- Aayati Verma
  ('3c4df2f5-c0b3-4fdd-9a5c-79063dd5bb1f'::uuid, '713dd5da-9cb3-4a65-a733-57971332249e'::uuid), -- Aislinn Dickey
  ('a952c5e2-a8ca-4b79-8fbc-bc56380da326'::uuid, 'b65fedf0-3c62-4a10-9d15-aaf2a50c927d'::uuid), -- Akiko Rogers
  ('a786cbac-bd5a-4fbf-bb6c-a768e3cded32'::uuid, '449c5d7e-176f-4213-a08a-379c0693cdca'::uuid), -- Ashley Paredes -> active employee
  ('57c7ff4c-87ea-4c59-9908-6d6bb0aaeb6e'::uuid, 'ac945711-47a8-489e-b30c-c8df0567d256'::uuid), -- Barbara Long
  ('50c566c6-bbdb-4f22-9a9f-1cd8fcb9cca4'::uuid, '117a8efd-c265-498e-a6ea-10a37a3c08c5'::uuid), -- Brian Mossbrooks
  ('feb94fcc-5b8c-48ec-95a2-f27858afee08'::uuid, 'a441d022-15c5-4133-a2a5-3328c24ccaef'::uuid), -- Celestine Hoh
  ('424b4d60-e464-47dd-b0d5-a1e71018414c'::uuid, '30c9a3eb-7a19-48da-ac2c-152e1377e3d0'::uuid), -- Claudia Lau
  ('e2914ae0-a4d2-4120-b2ca-8170b7c82419'::uuid, '22d97da8-5f60-4cf7-be4f-f0528bdc91d3'::uuid), -- Eric Flores
  ('0e9d4b10-79fd-495a-88ec-6851de5d0ed8'::uuid, '09220133-9f02-4a4a-9768-3c7817dcd6bf'::uuid), -- Ireland Tinoco
  ('1e78dda7-bd62-40de-a89e-64c612dffd0a'::uuid, '80613db1-d36c-48c8-9b2f-02995f39a2b0'::uuid), -- Jessica Salazar
  ('61142784-59d2-4219-aac4-962889b68d5e'::uuid, 'a0d5d628-ed65-4eec-b76e-fcd093f8f70d'::uuid), -- Marianna Grillo
  ('4b9bccd7-abe7-40a0-80c5-5a9b7634736c'::uuid, '4f5c6f53-b293-4482-ba75-d87be4c68953'::uuid), -- Natalie Ulloa
  ('dbcb56cb-6e23-46ec-a4cc-82e191e789b7'::uuid, 'a3628d52-67a0-4a97-a45c-ff93d49a9a15'::uuid), -- Natalye Chandler
  ('62d4db6b-3d6b-4488-89df-e3e8fd07d098'::uuid, '4fe473ec-be2e-41fb-a747-5730832cf269'::uuid), -- Nauman Ali
  ('dbebc903-cfef-4b35-90fe-9b76b8d5e214'::uuid, '0b2ccb85-0c0c-4209-b592-83821a014d38'::uuid), -- Nichole Gibbs
  ('fb471b38-1177-4958-93cb-829a2f1098cd'::uuid, '860407ad-ba19-493a-a868-a41d808159fa'::uuid), -- Paige Morrison
  ('9c95089a-53cb-4a6b-bd46-a7a9b89c3937'::uuid, 'dafc524a-8c93-457a-9ca2-35e89a0065a3'::uuid), -- Rachael Banyasz
  ('784aaaf8-49e7-44c7-b01d-92b39d28772d'::uuid, 'fab246c6-bae0-4e6e-8c0a-b6579931b9c0'::uuid), -- Raquel Lay
  ('e92a9804-80fc-4f08-89ab-484e9957e9a0'::uuid, '7c963759-435c-4b3b-9d30-f1f01b711344'::uuid), -- Regina Herrera (No Rehire)
  ('fd194118-041e-4c68-90a7-1383ca3d8934'::uuid, 'd1ad9e7d-c49a-4072-b103-0352c0f5b53d'::uuid), -- Saul Garcia
  ('657704ad-1768-4766-9eda-0769b41eb937'::uuid, '42db95fd-ea8a-44bb-9793-6696e5dbbe33'::uuid), -- Sherry Vartanian
  ('3915143a-9f38-43d8-b3ea-a1270afd17d1'::uuid, '37517eb5-0439-4736-b458-9174c74d7aef'::uuid), -- Sonora Chavez
  ('887d4319-6459-419e-b043-e3ee532aea77'::uuid, '39155a57-a125-41b3-b574-127868b26035'::uuid), -- Taylor Stanberry
  ('4b59d128-3042-4289-9e02-aa88dd8ef56c'::uuid, '62010e04-4e65-48ef-8a07-11641bf0988d'::uuid), -- Taylor Stepnosky
  ('8cb881c0-53d5-4170-8b9f-d6aca68ef8e1'::uuid, '039a814f-225e-441a-8166-0daeb3554106'::uuid), -- Tyler Crooks
  ('1ed2d808-b697-495c-8466-fe2a6a7252fb'::uuid, '6f75ca64-9f5a-4c75-8fbf-3af643081067'::uuid), -- Victoria Portillo
  ('27f2e797-344f-4ce2-8384-70a4fe4aaaff'::uuid, '62369ad1-e950-4b88-9ace-affe9180b489'::uuid)  -- Ziqi Zhou
) as v(ats_id, emp_id)
join greendogops.person per on per.id = v.ats_id
left join greendogops.person_recruiting rec on rec.person_id = v.ats_id
on conflict (ats_id) do nothing;

-- 2. Re-point recruiting history onto the canonical HR person (only when the
--    HR person has no recruiting row, to avoid a PK collision).
update greendogops.person_recruiting r
set person_id = b.emp_id,
    updated_at = now()
from greendogops.ats_hr_merge_backup_0032 b
where r.person_id = b.ats_id
  and not exists (
    select 1 from greendogops.person_recruiting r2 where r2.person_id = b.emp_id
  );

-- 3. Delete the ATS duplicate person rows (now stripped of recruiting history).
delete from greendogops.person per
using greendogops.ats_hr_merge_backup_0032 b
where per.id = b.ats_id;

commit;

-- Rollback recipe (manual): re-insert person/person_recruiting rows from
-- greendogops.ats_hr_merge_backup_0032.person_json / recruiting_json, and move
-- any re-pointed recruiting row back to its ats_id.
