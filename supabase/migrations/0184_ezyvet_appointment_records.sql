-- ============================================================================
-- Green Dog Ops — 0184 detailed appointment records
-- ----------------------------------------------------------------------------
-- A second ezyVet export path: Dashboard ▸ Records ▸ Record Type "Appointment"
-- ▸ Perform Action ▸ Export - Appointments. Unlike the Report Center's Agenda
-- pull (which we only aggregate into ezyvet_agenda_count), this gives ONE ROW
-- PER APPOINTMENT with its type, the resource it was booked on, the booking
-- note, and the client + pet codes — so appointment-type reporting, demand
-- forecasting and the Smart Report can work at appointment level.
--
-- The table shape is GENERATED from src/lib/reporting/report-specs.ts
-- (`appointment_records`) by scripts/gen_report_migration.mts — keep the two in
-- step. The views below are hand-written and live only here.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Appointment Records (detailed)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.ezyvet_appointment_record (
  id                         uuid primary key default gen_random_uuid(),
  resource                   text,
  division                   text,
  appt_date                  date,
  start_time                 text,
  end_date                   date,
  end_time                   text,
  appointment_type           text,
  appointment_group          text,
  description                text,
  client_name                text,
  client_code                text,
  pet_name                   text,
  pet_code                   text,
  preferred_contact          text,
  client_landline            text,
  client_mobile              text,
  client_email               text,
  client_address             text,
  animal_referring_clinic    text,
  animal_referring_vet       text,
  clinical_referring_clinic  text,
  clinical_referring_vet     text,
  location_key               text,

  snapshot_date              date not null,
  period_start               date,
  period_end                 date,
  created_at                 timestamptz not null default now()
);

create index if not exists ezyvet_appointment_record_date_idx
  on greendogops.ezyvet_appointment_record (appt_date);
create index if not exists ezyvet_appointment_record_snapshot_idx
  on greendogops.ezyvet_appointment_record (snapshot_date);
create index if not exists ezyvet_appointment_record_location_idx
  on greendogops.ezyvet_appointment_record (location_key);
create index if not exists ezyvet_appointment_record_type_idx
  on greendogops.ezyvet_appointment_record (appointment_type);
create index if not exists ezyvet_appointment_record_pet_idx
  on greendogops.ezyvet_appointment_record (pet_code);
create index if not exists ezyvet_appointment_record_client_idx
  on greendogops.ezyvet_appointment_record (client_code);

comment on table greendogops.ezyvet_appointment_record is
  'THE appointment-level table: one row per appointment, covering every hospital, with appointment_type, appointment_group, the resource/column it was booked on, the free-text booking note (description), and the client and pet it belongs to. Pulled from the ezyVet Records dashboard (not the Report Center), so it carries detail the agenda counts do not. Join pet_code to ezyvet_animal.animal_code for species/breed/master problems/animal notes, and client_code to ezyvet_contact.contact_code for the client record. Rows with an empty client_code/pet_code are blocks and internal calendar entries, not real bookings — exclude them when counting appointments. Cancelled appointments ARE included (the export is run with ''include cancelled''), and there is no status column here, so use ezyvet_appointment_status or cancelled_appointments for status questions. The window is rebuilt on every pull, so re-running a date range is idempotent and reflects reschedules. Prefer the report_appointment_* views so answers match the Reporting page.';

-- ---------------------------------------------------------------------------
-- Appointment detail, joined to the patient and client records.
--
-- This is where the export lines up with the data we already hold: master
-- problems and animal notes live on ezyvet_animal, client notes on
-- ezyvet_contact. `is_booking` marks the rows that are real client bookings —
-- the export also returns calendar blocks, holds and internal columns, which
-- have no client/pet attached and must not be counted as appointments.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_appointment_detail as
select r.id,
       r.appt_date,
       r.start_time,
       r.end_time,
       -- "07:00AM" + the date, so appointments sort and window correctly.
       case
         when r.start_time ~ '^\d{1,2}:\d{2}\s*[AP]M$'
           then (r.appt_date::text || ' ' || r.start_time)::timestamp
       end                                              as appt_start,
       r.location_key,
       r.division,
       r.resource,
       r.appointment_type,
       r.appointment_group,
       r.description                                    as booking_note,
       r.client_code,
       r.client_name,
       r.client_email,
       r.client_mobile,
       r.pet_code,
       r.pet_name,
       (nullif(r.client_code, '') is not null
        or nullif(r.pet_code, '') is not null)          as is_booking,
       a.id                                             as animal_id,
       a.species,
       a.breed,
       a.sex,
       a.date_of_birth,
       a.master_problems,
       a.animal_notes,
       a.is_active                                      as pet_is_active,
       a.has_passed_away,
       c.id                                             as contact_id,
       c.notes                                          as client_notes,
       c.customer_group,
       c.ezyvet_created_at                              as client_since,
       coalesce(r.clinical_referring_clinic, r.animal_referring_clinic) as referring_clinic,
       coalesce(r.clinical_referring_vet, r.animal_referring_vet)       as referring_vet
from greendogops.ezyvet_appointment_record r
left join greendogops.ezyvet_animal a
  on nullif(r.pet_code, '') is not null and a.animal_code = r.pet_code
left join greendogops.ezyvet_contact c
  on nullif(r.client_code, '') is not null and c.contact_code = r.client_code;

comment on view greendogops.report_appointment_detail is
  'One row per appointment joined to its patient (ezyvet_animal, incl. species, breed, master_problems, animal_notes) and its client (ezyvet_contact, incl. notes). appt_start combines appt_date with the "07:00AM" start_time. Filter is_booking to exclude calendar blocks and internal columns, which have no client or pet.';

-- ---------------------------------------------------------------------------
-- Appointment-type volume: the roll-up scheduling and planning guides read.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_appointment_type_volume as
select appt_date,
       date_trunc('month', appt_date)::date            as month,
       trim(to_char(appt_date, 'Day'))                 as day_of_week,
       location_key,
       coalesce(nullif(appointment_type, ''), 'Unspecified') as appointment_type,
       count(*)                                        as appointments,
       count(distinct nullif(pet_code, ''))            as patients,
       count(distinct nullif(client_code, ''))         as clients
from greendogops.ezyvet_appointment_record
where appt_date is not null
  and (nullif(client_code, '') is not null or nullif(pet_code, '') is not null)
group by 1, 2, 3, 4, 5;

comment on view greendogops.report_appointment_type_volume is
  'Booked appointments per day, hospital and appointment type (calendar blocks excluded). Use for appointment-type mix, demand forecasting and sizing scheduling templates. Covers past AND future dates, because the export is run over whatever window was requested.';

-- ---------------------------------------------------------------------------
-- Same counts by species, so demand can be split Dog / Cat / Exotic.
-- ---------------------------------------------------------------------------
create or replace view greendogops.report_appointment_type_by_species as
select d.appt_date,
       date_trunc('month', d.appt_date)::date as month,
       d.location_key,
       coalesce(nullif(d.appointment_type, ''), 'Unspecified') as appointment_type,
       coalesce(nullif(d.species, ''), 'Unknown')              as species,
       count(*)                                                as appointments
from greendogops.report_appointment_detail d
where d.appt_date is not null and d.is_booking
group by 1, 2, 3, 4, 5;

comment on view greendogops.report_appointment_type_by_species is
  'Booked appointments per day, hospital, appointment type and patient species (species comes from ezyvet_animal via pet_code, so it is null-bucketed as Unknown when the pet has not been matched).';

-- Views are service-role only by convention (0164/0165): they cannot enforce RLS.
grant select on
  greendogops.report_appointment_detail,
  greendogops.report_appointment_type_volume,
  greendogops.report_appointment_type_by_species
to service_role;

-- ---------------------------------------------------------------------------
-- Agent catalog entry so the pull shows up in Admin ▸ Agents.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'appointment_records', 'Appointment Records (detailed)', 'global',
       'One row per booked appointment with its type, pet, owner and booking note.',
       'ezyvet_appointment_record', 11
from greendogops.agent a
where a.key = 'ezyvet_extra_reports'
on conflict (agent_id, key) do nothing;
