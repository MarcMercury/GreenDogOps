-- ============================================================================
-- Green Dog Ops — 0084 CE event backfill (historical events + RACE details)
-- ----------------------------------------------------------------------------
-- Promotes the historical CE events that only existed as repeated ce_name
-- strings on crm_ce_attendance into first-class crm_ce_event records, then
-- links every attendance row to its parent event by matching ce_name.
--
-- Event details are sourced from the AAVSB RACE / CE Broker provider portal
-- (the two RACE-approved Green Dog programs) plus the July 2026 Abdominal
-- Ultrasound setup + agenda PDFs:
--   * RACE 20-1281086  "Advancements in Veterinary Dentistry: A Hands-on
--     Workshop"  — Dr. Loïc Legendre, 14.25 medical CE hrs.
--   * RACE 20-1305377  "Abdominal Ultrasound: Beyond the Basics" — Dr. Michael
--     Geist, 14.00 medical CE hrs.
-- The dentistry course ran as two offerings (Apr 2025, Oct 2025) and the
-- ultrasound course as two offerings (Oct 2025, July 2026); each offering is a
-- separate event that shares the same RACE tracking number.
--
-- Events are named EXACTLY as the existing attendance ce_name so the link step
-- attaches the right roster. Idempotent: re-running inserts nothing new and
-- only fills still-null ce_event_id links.
-- ============================================================================
set search_path = greendogops, public;

-- ----------------------------------------------------------------------------
-- 1) Advancements in Veterinary Dentistry (Apr 2025)  — RACE 20-1281086
-- ----------------------------------------------------------------------------
insert into greendogops.crm_ce_event (
  name, event_date, end_date, start_time, end_time, location, subject,
  presenters, description, cost_type, cost_amount, audience, status, capacity,
  course_type, delivery_method, tracking_number, learning_objectives,
  disclosure_statements, approval_board, approval_status, race_approved,
  ce_hours_total, ce_hours_medical, ce_hours_nonmedical,
  effective_start, effective_end, projected_offering_date, rosters_allowed_date,
  presenter_bio, who_should_attend, social_dinner
)
select
  'Advancements in Veterinary Dentistry (Apr 2025)',
  date '2025-04-05', date '2025-04-06', '08:30', '17:00',
  '14661 Aetna St, Van Nuys CA 91411',
  'Veterinary Dentistry',
  'Dr. Loïc Legendre, DVM, AVDC, EVDC',
  'This intensive hands-on workshop is designed for veterinarians seeking to expand their practical skills in veterinary dentistry. Led by Dr. Loïc Legendre, DVM, AVDC, EVDC, one of the foremost experts in the field, this course covers essential and advanced dental techniques applicable to small animal practice. Participants gain practical experience in radiographic interpretation, periodontal disease management, surgical extractions, pain control, and endodontic procedures. The hands-on portion allows attendees to practice surgical techniques under direct expert supervision.',
  'free', null, 'dvm', 'completed', null,
  'Live Course', 'Seminar/Lecture & Lab/Wet Lab', '20-1281086',
  'Understand veterinary dental anatomy and the pathophysiology of common dental diseases. Accurately interpret dental radiographs to diagnose oral pathology. Perform surgical extractions and periodontal surgery using proper techniques.',
  'GreenDog Dental Veterinary Center and Dr. Loïc Legendre, DVM, AVDC, EVDC, declare that no financial relationships, sponsorships, or commercial interests influence the content of this CE course. This program is designed solely for educational purposes, providing evidence-based veterinary dental knowledge.',
  'AAVSB', 'approved', true,
  14.25, 14.25, 0,
  date '2025-03-13', date '2027-03-13', date '2025-04-05', date '2025-02-04',
  'Dr. Loïc Legendre, DVM, AVDC, EVDC — board-certified in both the American (AVDC) and European (EVDC) Veterinary Dental Colleges and one of the foremost experts in veterinary dentistry.',
  'Veterinarians (DVMs)', false
where not exists (
  select 1 from greendogops.crm_ce_event
  where name = 'Advancements in Veterinary Dentistry (Apr 2025)'
);

-- ----------------------------------------------------------------------------
-- 2) Fall Dentistry CE (Oct 2025)  — RACE 20-1281086 (second offering)
-- ----------------------------------------------------------------------------
insert into greendogops.crm_ce_event (
  name, event_date, end_date, start_time, end_time, location, subject,
  presenters, description, cost_type, cost_amount, audience, status, capacity,
  course_type, delivery_method, tracking_number, learning_objectives,
  disclosure_statements, approval_board, approval_status, race_approved,
  ce_hours_total, ce_hours_medical, ce_hours_nonmedical,
  effective_start, effective_end, projected_offering_date, rosters_allowed_date,
  presenter_bio, who_should_attend, social_dinner
)
select
  'Fall Dentistry CE (Oct 2025)',
  date '2025-10-29', date '2025-10-30', '08:30', '17:00',
  '14661 Aetna St, Van Nuys CA 91411',
  'Veterinary Dentistry',
  'Dr. Loïc Legendre, DVM, AVDC, EVDC',
  'Fall 2025 offering of the RACE-approved hands-on veterinary dentistry workshop led by Dr. Loïc Legendre, DVM, AVDC, EVDC. Covers essential and advanced dental techniques for small animal practice: radiographic interpretation, periodontal disease management, surgical extractions, pain control, and endodontic procedures, with hands-on surgical practice under direct expert supervision.',
  'free', null, 'dvm', 'completed', null,
  'Live Course', 'Seminar/Lecture & Lab/Wet Lab', '20-1281086',
  'Understand veterinary dental anatomy and the pathophysiology of common dental diseases. Accurately interpret dental radiographs to diagnose oral pathology. Perform surgical extractions and periodontal surgery using proper techniques.',
  'GreenDog Dental Veterinary Center and Dr. Loïc Legendre, DVM, AVDC, EVDC, declare that no financial relationships, sponsorships, or commercial interests influence the content of this CE course. This program is designed solely for educational purposes, providing evidence-based veterinary dental knowledge.',
  'AAVSB', 'approved', true,
  14.25, 14.25, 0,
  date '2025-03-13', date '2027-03-13', date '2025-04-05', date '2025-02-04',
  'Dr. Loïc Legendre, DVM, AVDC, EVDC — board-certified in both the American (AVDC) and European (EVDC) Veterinary Dental Colleges and one of the foremost experts in veterinary dentistry.',
  'Veterinarians (DVMs)', false
where not exists (
  select 1 from greendogops.crm_ce_event
  where name = 'Fall Dentistry CE (Oct 2025)'
);

-- ----------------------------------------------------------------------------
-- 3) Advanced Abdominal Ultrasound CE (Oct 2025)  — RACE 20-1305377
-- ----------------------------------------------------------------------------
insert into greendogops.crm_ce_event (
  name, event_date, end_date, start_time, end_time, location, subject,
  presenters, description, cost_type, cost_amount, audience, status, capacity,
  course_type, delivery_method, tracking_number, learning_objectives,
  disclosure_statements, approval_board, approval_status, race_approved,
  ce_hours_total, ce_hours_medical, ce_hours_nonmedical,
  effective_start, effective_end, projected_offering_date, rosters_allowed_date,
  presenter_bio, who_should_attend, social_dinner
)
select
  'Advanced Abdominal Ultrasound CE',
  date '2025-10-04', date '2025-10-05', '08:30', '17:00',
  '14661 Aetna St, Van Nuys CA 91411',
  'Abdominal Ultrasound',
  'Dr. Michael Geist, DVM, DACVIM',
  'This two-day, clinically focused, hands-on course is designed for practicing veterinarians seeking to advance their ultrasound imaging skills for abdominal diagnostics in general practice settings. With over eight hours of laboratory sessions using live dogs and cats, participants learn to operate ultrasound machines, optimize image quality, and perform comprehensive abdominal ultrasound examinations, gaining a deep understanding of normal abdominal anatomy and the techniques needed to consistently obtain diagnostic images.',
  'paid', 1629, 'dvm', 'completed', 20,
  'Live Course', 'Seminar/Lecture & Lab/Wet Lab', '20-1305377',
  'Operate ultrasound machines and optimize image quality. Perform a systematic, comprehensive abdominal ultrasound examination in dogs and cats. Recognize normal abdominal organ anatomy and its sonographic appearance. Identify common diagnostic pitfalls and interpret normal vs. abnormal findings.',
  'Green Dog Veterinary Center and Dr. Michael Geist affirm that this educational program is free from commercial bias and adheres to RACE standards for content integrity. While Samsung is providing ultrasound equipment and event support, they do not influence the educational content or learning objectives of this course. Dr. Geist has no financial relationship with Samsung.',
  'AAVSB', 'approved', true,
  14, 14, 0,
  date '2025-06-23', date '2027-06-23', date '2025-07-26', date '2025-05-22',
  'Dr. Michael Geist, DVM, DACVIM (Small Animal Internal Medicine) — Chief Medical Officer for Green Dog Veterinary Center and a board-certified internal medicine specialist practicing in private practice since 2006.',
  'Veterinarians (DVMs)', false
where not exists (
  select 1 from greendogops.crm_ce_event
  where name = 'Advanced Abdominal Ultrasound CE'
);

-- ----------------------------------------------------------------------------
-- 4) Ultrasound CE (July 2026)  — RACE 20-1305377 (July 11-12 2026 offering)
--    Details from the setup/registration + program agenda PDFs.
-- ----------------------------------------------------------------------------
insert into greendogops.crm_ce_event (
  name, event_date, end_date, start_time, end_time, location, subject,
  presenters, description, cost_type, cost_amount, audience, status, capacity,
  course_type, delivery_method, tracking_number, learning_objectives,
  disclosure_statements, approval_board, approval_status, race_approved,
  ce_hours_total, ce_hours_medical, ce_hours_nonmedical,
  effective_start, effective_end, projected_offering_date, rosters_allowed_date,
  presenter_bio, who_should_attend, whats_included, social_dinner, itinerary
)
select
  'Ultrasound CE (July 2026)',
  date '2026-07-11', date '2026-07-12', '08:30', '17:00',
  'Green Dog Dental & Veterinary Center, 14661 Aetna St, Van Nuys CA 91411',
  'Abdominal Ultrasound',
  'Dr. Michael Geist, DVM, DACVIM & Dr. Ren Garcia',
  'CE — Abdominal Ultrasound: Beyond the Basics. A two-day, clinically focused, hands-on course covering abdominal ultrasound techniques and clinical applications for general practice. Over eight hours of hands-on lab work using live dogs and cats teaches participants to operate ultrasound machines, optimize image quality, and perform comprehensive abdominal ultrasound examinations. Ultrasound machines provided by Samsung.',
  'paid', 1629, 'dvm', 'completed', 20,
  'Live Course', 'Seminar/Lecture & Lab/Wet Lab', '20-1305377',
  'Operate ultrasound machines and optimize image quality. Perform a systematic, comprehensive abdominal ultrasound examination in dogs and cats. Recognize normal abdominal organ anatomy and its sonographic appearance. Identify common diagnostic pitfalls and interpret normal vs. abnormal findings.',
  'Green Dog Veterinary Center and Dr. Michael Geist affirm that this educational program is free from commercial bias and adheres to RACE standards for content integrity. While Samsung is providing ultrasound equipment and event support, they do not influence the educational content or learning objectives of this course. Dr. Geist has no financial relationship with Samsung.',
  'AAVSB', 'approved', true,
  14, 14, 0,
  date '2025-06-23', date '2027-06-23', date '2025-07-26', date '2025-05-22',
  'Dr. Michael Geist, DVM, DACVIM (Small Animal Internal Medicine) — Chief Medical Officer for Green Dog Veterinary Center and a board-certified internal medicine specialist practicing in private practice since 2006.',
  'Veterinarians (DVMs) only — 20 spots available',
  'Course materials and printed notes; breakfast, lunch, snacks, and refreshments; certificate of completion; special thank-you gifts for all attendees; access to post-event resource links and scan protocols.',
  true,
  '[
    {"id":"d1-0830","day":"2026-07-11","time":"08:30","description":"Check-in & Welcome — light breakfast and course orientation"},
    {"id":"d1-0900","day":"2026-07-11","time":"09:00","description":"Introduction to Ultrasound Principles — machine functions, probe types, settings, scanning fundamentals (1.5 hr)"},
    {"id":"d1-1030","day":"2026-07-11","time":"10:30","description":"Lecture: Abdominal Organ Anatomy & Sonographic Appearance — liver, spleen, kidneys, bladder, adrenal glands, GI tract (1.5 hr)"},
    {"id":"d1-1200","day":"2026-07-11","time":"12:00","description":"Lunch Break — catered on-site"},
    {"id":"d1-1300","day":"2026-07-11","time":"13:00","description":"Hands-On Lab: Basic Scanning Techniques — probe control, image optimization, scanning protocols (dogs and cats) (2.0 hr)"},
    {"id":"d1-1500","day":"2026-07-11","time":"15:00","description":"Hands-On Lab: Full Abdominal Survey — systematic scanning approach with instructor feedback (2.0 hr)"},
    {"id":"d2-0830","day":"2026-07-12","time":"08:30","description":"Arrival & Refreshments — light breakfast"},
    {"id":"d2-0900","day":"2026-07-12","time":"09:00","description":"Common Diagnostic Pitfalls in Ultrasound — errors in interpretation and how to avoid them (1.5 hr)"},
    {"id":"d2-1030","day":"2026-07-12","time":"10:30","description":"Case Studies: Interpreting Normal vs. Abnormal — interactive review of real cases and pathology patterns (1.5 hr)"},
    {"id":"d2-1200","day":"2026-07-12","time":"12:00","description":"Lunch Break — catered on-site"},
    {"id":"d2-1300","day":"2026-07-12","time":"13:00","description":"Hands-On Lab: Pathology Focus — abnormal findings, guided imaging of select pathology (2.0 hr)"},
    {"id":"d2-1500","day":"2026-07-12","time":"15:00","description":"Open Lab + Instructor Q&A — attendees rotate through stations with 1:1 instructor time (2.0 hr)"}
  ]'::jsonb
where not exists (
  select 1 from greendogops.crm_ce_event
  where name = 'Ultrasound CE (July 2026)'
);

-- ----------------------------------------------------------------------------
-- 5) NBW CE: Dr. Chapel — Feline Cardiology (Sep 25, Culver City)
--    Not a Green Dog RACE program; details taken from the event name. Kept
--    lightweight so the roster (37 attendees) has a home; enrich one-off later.
-- ----------------------------------------------------------------------------
insert into greendogops.crm_ce_event (
  name, event_date, end_date, start_time, location, subject, presenters,
  description, cost_type, audience, status
)
select
  'NBW CE: Dr. Chapel w/ Feline Cardio on 9/25 at 7pm in Culver City',
  null, null, '19:00',
  'Culver City, CA',
  'Feline Cardiology',
  'Dr. Chapel',
  'Nothing But The Waggiest (NBW) CE lunch-and-learn: Dr. Chapel on feline cardiology. Held 9/25 at 7:00 PM in Culver City.',
  'free', 'dvm', 'completed'
where not exists (
  select 1 from greendogops.crm_ce_event
  where name = 'NBW CE: Dr. Chapel w/ Feline Cardio on 9/25 at 7pm in Culver City'
);

-- ----------------------------------------------------------------------------
-- 6) Link attendance rows to their parent event by exact ce_name match.
-- ----------------------------------------------------------------------------
update greendogops.crm_ce_attendance a
set ce_event_id = e.id
from greendogops.crm_ce_event e
where a.ce_event_id is null
  and a.ce_name = e.name;
