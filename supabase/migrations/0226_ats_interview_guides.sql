-- ============================================================================
-- Green Dog Ops — 0226 Recruiting: role auto-response forms + interview guides
-- ----------------------------------------------------------------------------
-- 1. Interview guides become a third kind of recruiting form ("interview"),
--    edited in the Forms builder and filled in by the interviewer on the
--    candidate's Interview Tracking tab. A guide is tagged with the interview
--    types it covers (interview_types; empty = any) and, like every form, the
--    job titles it's for (job_titles; empty = any job).
-- 2. person_interview records which guide an interview was logged with. Its
--    responses keep a snapshot of each question, so editing a guide never
--    changes interviews already logged.
-- 3. Seed forms from the "Recruiting Posting Templates" Google Doc: the
--    Indeed auto-response questions per job become role-specific forms, and
--    the Remote CSR written exercise becomes its own form. The generic
--    "CSR Screening Questions" form is replaced (deactivated; its responses
--    stay on candidate profiles).
-- 4. Seed three interview guides: Phone Screen (from the "IN HOUSE CSR
--    INTERVIEW TEMPLATE"), In-Person / Shadow Day, and Final Interview.
-- Seeds are idempotent by form name.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- ---------------------------------------------------------------------------
-- 1. Interview guides
-- ---------------------------------------------------------------------------
alter table recruiting_form drop constraint if exists recruiting_form_kind_check;
alter table recruiting_form
  add constraint recruiting_form_kind_check
    check (kind in ('application', 'screening', 'interview'));

alter table recruiting_form
  add column if not exists interview_types text[] not null default '{}';

comment on table recruiting_form is
  'Recruiting forms: the public Standard Application, role-specific screening questionnaires, and interviewer-facing interview guides';
comment on column recruiting_form.interview_types is
  'Interview guides: person_interview.interview_type values the guide loads for (empty = any)';

-- ---------------------------------------------------------------------------
-- 2. Which guide an interview was logged with
-- ---------------------------------------------------------------------------
alter table person_interview
  add column if not exists guide_id uuid references recruiting_form (id) on delete set null,
  add column if not exists guide_name text;

comment on column person_interview.guide_id is 'Interview guide (recruiting_form kind = interview) the responses came from';
comment on column person_interview.guide_name is 'Guide name when the interview was logged';
comment on column person_interview.responses is
  '[{ id?, question, answer, type?, options?, description? }] — guide question snapshot; older rows have question/answer only';

create index if not exists person_interview_guide_idx
  on person_interview (guide_id) where guide_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Role-specific forms from the Indeed auto-responses
-- ---------------------------------------------------------------------------
update recruiting_form
set active = false
where kind = 'screening'
  and name in ('CSR Screening Questions', 'Green Dog Dental and Veterinary Center CSR Screening Questions')
  and active;

insert into recruiting_form (kind, name, description, intro, success_message, fields, job_titles)
select
  'screening',
  'Vet Tech Screening Questions',
  'Indeed auto-response for the Lead / Senior Veterinary Technician posting. Send after approval, before the phone screen.',
  $t$Thank you for applying for the Lead Veterinary Technician position at Green Dog Dental & Veterinary Center.

We hire with intention and view every new team member as a long-term investment. Because this is a leadership position, we are looking for someone who combines strong clinical skills with accountability, clear communication, and the ability to develop and support a high-performing team.

Before you answer, please review our website, including our services and careers pages:
https://www.greendogdental.com
https://www.greendogdental.com/about-us/careers

Please complete this within 24 hours. Provide thoughtful, specific responses. Your answers will be considered as part of our initial application review.$t$,
  $t$Thank you! We look forward to learning more about you.

Warmly,
Jenn
Career Development Department
Green Dog Dental & Veterinary Center
Sherman Oaks | Venice | Van Nuys$t$,
  $json$[
    {"id": "website_standouts", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "After reviewing our website, which aspects of Green Dog's medicine, services, or culture stood out to you, and why?"},
    {"id": "leading_interest", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "What specifically interests you about leading a veterinary technician team at Green Dog?"},
    {"id": "clinical_skills", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Please describe your current clinical skill set, including the procedures, specialties, and types of cases you are most experienced handling."},
    {"id": "improvement_example", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Tell us about a time you improved a hospital workflow, elevated patient-care standards, or addressed a performance issue with a team member. What actions did you take, and what was the result?"},
    {"id": "team_accountability", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "How do you train, motivate, and hold technicians accountable while maintaining a collaborative work environment?"},
    {"id": "greatest_contribution", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Based on what you learned about Green Dog, where do you believe your experience could make the greatest contribution to our hospitals?"},
    {"id": "next_position", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "What are you looking for in your next position, and what would make you want to build a long-term career with a veterinary organization?"}
  ]$json$::jsonb,
  array['Senior Vet Tech', 'Vet Tech', 'RVT', 'Clinic Tech']
where not exists (select 1 from recruiting_form where name = 'Vet Tech Screening Questions');

insert into recruiting_form (kind, name, description, intro, success_message, fields, job_titles)
select
  'screening',
  'In-House CSR Screening Questions',
  'Indeed auto-response for the In House Veterinary Receptionist posting. Send after approval, before the phone screen.',
  $t$Thanks for applying for the receptionist role at Green Dog Dental & Veterinary Center. We looked over your application and wanted to follow up directly before we set up a call.

Please complete this within 24 hours. Candidates who don't respond in that window won't be considered for this round.$t$,
  $t$Thank you! We'll review your answers and reach out about next steps.

Warmly,
Jenn
Career Development Department
Sherman Oaks | Venice | Van Nuys$t$,
  $json$[
    {"id": "why_green_dog", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Why are you applying to Green Dog, and why this role specifically?"},
    {"id": "upset_client", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Describe a time you had to stay calm and helpful with an upset or emotional client. What did you do?"},
    {"id": "start_date", "type": "date", "required": true, "options": [], "description": null,
     "label": "What's your earliest start date?"},
    {"id": "full_time_schedule", "type": "yes_no", "required": true, "options": [],
     "description": "This is a full-time position, 5 days a week (8-hour shifts). You're expected to be available Monday through Saturday. Shifts start as early as 8 am and end as late as 8 pm.",
     "label": "Can you confirm you're available for this schedule?"},
    {"id": "schedule_notes", "type": "long_text", "required": false, "options": [], "description": null,
     "label": "If not, or if you have any restrictions, please explain."},
    {"id": "website_owner", "type": "short_text", "required": true, "options": [],
     "description": "See the About Us page at greendogdental.com.",
     "label": "On our website's About Us page, who is listed as the practice owner or lead veterinarian?"}
  ]$json$::jsonb,
  array['CSR']
where not exists (select 1 from recruiting_form where name = 'In-House CSR Screening Questions');

insert into recruiting_form (kind, name, description, intro, success_message, fields, job_titles)
select
  'screening',
  'Remote CSR Screening Questions',
  'Indeed auto-response for the Remote Veterinary Receptionist posting. Send after approval; follow with the Remote CSR Written Exercise.',
  $t$Thank you for taking the time to apply for the Remote Client Service Representative position at Green Dog Dental & Veterinary Center. We truly appreciate your interest in joining our team.

I want to be transparent about our hiring process. We hire with intention. This is not a position we fill quickly or casually. We are looking for someone who is seeking more than just a job: someone who wants to build a long-term career and grow alongside our team.

Each time we open this position, we receive a large number of applications. Rather than rushing the process, we carefully review candidates who genuinely align with our values, our culture, and the exceptional level of client service we're known for.

We are looking for individuals who genuinely enjoy helping people, understand the emotional nature of veterinary medicine, communicate with empathy and professionalism, and are excited about growing within an organization that invests in its team.

https://www.greendogdental.com/about-us/careers$t$,
  $t$Thank you for the time you took to respond. I look forward to learning more about you.

Warmly,
Jenn
Career Development Department
Green Dog Dental & Veterinary Center
Sherman Oaks | Venice | Van Nuys$t$,
  $json$[
    {"id": "why_green_dog", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Why are you specifically interested in joining Green Dog?"},
    {"id": "role_attraction", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "What attracted you to this Remote Client Service Representative position?"},
    {"id": "sets_you_apart", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "What sets you apart from other candidates?"},
    {"id": "excellent_fit", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Why do you believe you would be an excellent fit for this role?"},
    {"id": "next_opportunity", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "What are you looking for in your next career opportunity?"}
  ]$json$::jsonb,
  array['Remote CSR']
where not exists (select 1 from recruiting_form where name = 'Remote CSR Screening Questions');

insert into recruiting_form (kind, name, description, intro, success_message, fields, job_titles)
select
  'screening',
  'Remote CSR Written Exercise',
  'The "Email RCSR Response" exercise: replies to mock client emails and texts. Send before the Remote CSR phone interview.',
  $t$Thank you for applying for the remote Client Service Representative position at Green Dog Dental & Veterinary Center. I'm Jenn from our Career Development Department.

We believe you may be a strong fit for this role, and before moving forward with a phone interview, we ask that you complete a brief but meaningful exercise. It will help us assess how clearly, professionally, and efficiently you communicate. It also gives us insight into the level of effort you are willing to invest in earning a position at a company that truly invests in its people.

About us: At Green Dog, we are a close-knit practice that puts our staff first. When our team thrives, our patients and clients do too. We are privately owned and operated with three beautiful clinics in Los Angeles: Sherman Oaks, Venice, and The Valley. We are known for excellence in dental, exotic, and specialty care, and we operate strictly by appointment only. We are a high-touch, high-standard clinic that values smart, emotionally intelligent people who take initiative and pride in their work.

Step 1: Study us
• Green Dog Dental website: https://www.greendogdental.com
• Green Dog Dental Q&A document: https://docs.google.com/document/d/1V4DUSCPAXySTKGjFSiXIC0tJE-f2mZGbv9b_3JpZEew/edit
Only respond to questions covered in the Q&A. Anything else should be referred to a doctor.

Step 2: Reply to the mock client messages below as if you were on our remote client service team.

Reminders: Use proper grammar, tone, and punctuation. Respond promptly; timing matters. Be professional, empathetic, and human.$t$,
  $t$Thank you! I look forward to reviewing your responses and scheduling the next step.

Best,
Jenn
Career Development
Sherman Oaks | Venice$t$,
  $json$[
    {"id": "email_section", "type": "section", "required": false, "options": [],
     "description": "Write the email you would send back to each client.",
     "label": "Email replies"},
    {"id": "email_yorkie", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Email 1: \"Hi! My 6-year-old Yorkie, 'Little Finger,' has awful breath but I don't want to put him under. Can you confirm you clean his teeth without anesthesia?\""},
    {"id": "email_labrador", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Email 2: \"My vet said my Labrador 'Cersei' has a broken tooth. How much does it cost to pull it?\""},
    {"id": "email_maltese", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Email 3: \"I've heard great things about you guys! My Maltese 'Daenerys' has diarrhea and an ear infection. What should I do?\""},
    {"id": "text_section", "type": "section", "required": false, "options": [],
     "description": "Write the text message you would send back to each client.",
     "label": "Text message replies"},
    {"id": "text_drogo", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Text 1: \"My dog 'Drogo' had surgery yesterday and still will not eat or take his meds. Should I be worried?\""},
    {"id": "text_bleeding", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Text 2: \"HELP! I just brought my cat home from surgery and she is bleeding from her mouth!\""},
    {"id": "text_upset", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Text 3: \"I came in yesterday and now my dog is in pain. You guys HURT HIM! He is not himself. Shame on you!\""}
  ]$json$::jsonb,
  array['Remote CSR']
where not exists (select 1 from recruiting_form where name = 'Remote CSR Written Exercise');

insert into recruiting_form (kind, name, description, intro, success_message, fields, job_titles)
select
  'screening',
  'Non-Anesthetic Dental Tech Screening Questions',
  'Indeed auto-response for the Non-Anesthetic Pet Dental Technician posting. Send after approval, before the phone screen.',
  $t$My name is Jenn, and I'm part of the Career Development team here at Green Dog Dental & Veterinary Center. Thank you for submitting your application for our Non-Anesthetic Dental Technician position.

As we begin reviewing applicants, we'd like to gather a bit more information from you. This role is highly specialized and requires specific experience and skills, so your answers will help us determine whether it's a strong match.$t$,
  $t$Thank you again for your interest in joining our team. I look forward to hearing from you!

Warmly,
Jenn
Career Development
Sherman Oaks | Venice | Van Nuys
greendogdental.com$t$,
  $json$[
    {"id": "why_applied", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Why did you apply for this position?"},
    {"id": "role_familiarity", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "Are you familiar with the primary responsibilities of this role? If so, please describe what you believe the day-to-day duties would include."},
    {"id": "handling_experience", "type": "long_text", "required": true, "options": [], "description": null,
     "label": "How many years of hands-on animal handling experience do you have? Please include details about where and how you gained this experience."},
    {"id": "nad_performed", "type": "yes_no", "required": true, "options": [], "description": null,
     "label": "Have you ever performed a non-anesthetic dental cleaning on a dog or cat?"},
    {"id": "nad_details", "type": "long_text", "required": false, "options": [], "description": null,
     "label": "If yes, please elaborate."}
  ]$json$::jsonb,
  array['Dental Tech', 'Dentals (trainee)']
where not exists (select 1 from recruiting_form where name = 'Non-Anesthetic Dental Tech Screening Questions');

-- ---------------------------------------------------------------------------
-- 4. Interview guides
-- ---------------------------------------------------------------------------
insert into recruiting_form (kind, name, description, intro, fields, job_titles, interview_types, require_resume)
select
  'interview',
  'Phone Screen Interview Guide',
  'From the IN HOUSE CSR INTERVIEW TEMPLATE. Loads for every phone and virtual interview.',
  $t$Take notes in the candidate's own words. If you skip a question, write "Not discussed" so the next interviewer knows to ask. Set the Overall grade and Recommendation above, and use Summary for your overall impression.$t$,
  $json$[
    {"id": "core_section", "type": "section", "required": false, "options": [], "label": "Core questions",
     "description": "Cover these on every phone screen."},
    {"id": "vet_experience", "type": "long_text", "required": false, "options": [],
     "label": "Veterinary experience: Can you briefly walk me through your experience in veterinary medicine (clinical, customer service, or both)? What position is ideal for you?",
     "description": "Note each clinic, how long, practice type (GP, ER, specialty), daily volume, and their duties."},
    {"id": "tech_skills", "type": "long_text", "required": false, "options": [],
     "label": "Technology & software skills: Have you used ezyVet before? If not, what veterinary software have you worked with? Are you comfortable using Google Drive/Docs, spreadsheets, etc.? Have you ever used Slack or a similar tool for internal communication?",
     "description": null},
    {"id": "tools_confirmed", "type": "checkboxes", "required": false,
     "options": ["ezyVet", "Other veterinary software", "Google Drive / Docs", "Spreadsheets", "Slack or similar"],
     "label": "Tools confirmed", "description": null},
    {"id": "client_coworker_situation", "type": "long_text", "required": false, "options": [],
     "label": "Client or coworker situation: Can you share a quick example of a time you handled a challenging client or coworker situation? How did you handle it?",
     "description": "Push for a specific example: what happened, what they did, how it ended."},
    {"id": "reliability", "type": "long_text", "required": false, "options": [],
     "label": "Reliability (direct & guided): Let me ask you directly. Would you say you're reliable? Do you call out often, show up late, or have trouble following through on your responsibilities? How would your past coworkers or managers describe your reliability?",
     "description": null},
    {"id": "self_awareness", "type": "long_text", "required": false, "options": [],
     "label": "Self-awareness & team fit: What would your coworkers say is the best thing about working with you? And what's one thing they might say you could improve on?",
     "description": null},
    {"id": "location_schedule", "type": "long_text", "required": false, "options": [],
     "label": "Location & schedule: Are you open to working in Sherman Oaks, Van Nuys, Venice, or all of the above? Do you have any day or time restrictions?",
     "description": "Confirm reliable transportation and how long the commute would be."},
    {"id": "locations_ok", "type": "checkboxes", "required": false,
     "options": ["Sherman Oaks", "Van Nuys", "Venice", "Remote"],
     "label": "Locations they can work", "description": null},
    {"id": "future", "type": "long_text", "required": false, "options": [],
     "label": "Future: Are you looking for a long-term position? What kind of role are you hoping to grow into?",
     "description": null},

    {"id": "background_section", "type": "section", "required": false, "options": [], "label": "Background / personality", "description": null},
    {"id": "about_you", "type": "long_text", "required": false, "options": [],
     "label": "Tell me a bit about yourself: where are you from, hobbies, interests outside of the veterinary field.", "description": null},
    {"id": "describe_yourself", "type": "long_text", "required": false, "options": [],
     "label": "Describe yourself.", "description": null},
    {"id": "where_located", "type": "short_text", "required": false, "options": [],
     "label": "Where are you located?", "description": null},
    {"id": "any_career", "type": "long_text", "required": false, "options": [],
     "label": "If you could have any career, what would it be?", "description": null},
    {"id": "ideal_schedule", "type": "long_text", "required": false, "options": [],
     "label": "If you could create your ideal work schedule, what would that be?", "description": null},
    {"id": "ideal_environment", "type": "long_text", "required": false, "options": [],
     "label": "What is your ideal work environment?", "description": null},
    {"id": "availability", "type": "long_text", "required": false, "options": [],
     "label": "What is your current availability? Any restrictions on days you cannot work?",
     "description": "Also ask how much notice they need to give their current employer."},
    {"id": "full_or_part_time", "type": "multiple_choice", "required": false,
     "options": ["Full-time", "Part-time", "Either"],
     "label": "Are you looking for full-time or part-time?", "description": null},
    {"id": "pay_expectation", "type": "short_text", "required": false, "options": [],
     "label": "How much are you wanting to make in this position?", "description": null},

    {"id": "preparedness_section", "type": "section", "required": false, "options": [], "label": "Preparedness", "description": null},
    {"id": "how_prepared", "type": "long_text", "required": false, "options": [],
     "label": "How did you prepare for this call?", "description": null},
    {"id": "website_standouts", "type": "long_text", "required": false, "options": [],
     "label": "Did you search the Green Dog Dental website? What stood out to you?", "description": null},
    {"id": "know_what_we_do", "type": "long_text", "required": false, "options": [],
     "label": "How much do you know about what we do?", "description": null},

    {"id": "work_history_section", "type": "section", "required": false, "options": [], "label": "Work history", "description": null},
    {"id": "past_experience", "type": "long_text", "required": false, "options": [],
     "label": "Tell me about your past experience in the veterinary field in this role.", "description": null},
    {"id": "current_job", "type": "long_text", "required": false, "options": [],
     "label": "Tell me a bit about your current / most recent job. Why did you leave, or why are you wanting to leave?", "description": null},
    {"id": "enjoy_most", "type": "long_text", "required": false, "options": [],
     "label": "What do you enjoy the most about your current job?", "description": null},
    {"id": "enjoy_least", "type": "long_text", "required": false, "options": [],
     "label": "What do you not enjoy about your current job?", "description": null},

    {"id": "skills_section", "type": "section", "required": false, "options": [], "label": "Role skills & conflict resolution",
     "description": "Written for client service roles. Adapt the wording for clinical roles."},
    {"id": "why_this_role", "type": "long_text", "required": false, "options": [],
     "label": "Why do you want a position as a client services representative (or this role)?", "description": null},
    {"id": "client_conflict", "type": "long_text", "required": false, "options": [],
     "label": "How do you deal with conflict with clients?", "description": null},
    {"id": "unreasonable_client", "type": "long_text", "required": false, "options": [],
     "label": "Give an example of a situation you encountered where a client was unreasonable. What did you do?", "description": null},
    {"id": "peer_differences", "type": "long_text", "required": false, "options": [],
     "label": "How have you resolved differences with peers or others?", "description": null},
    {"id": "peer_dispute", "type": "long_text", "required": false, "options": [],
     "label": "Tell me about a dispute you've had with a peer in the past. What was it about? What did you do? How did it end up?", "description": null},
    {"id": "colleagues_describe", "type": "long_text", "required": false, "options": [],
     "label": "If I were to walk into your last workplace and ask your colleagues to describe you, how would they describe you?", "description": null},
    {"id": "difficult_coworker", "type": "long_text", "required": false, "options": [],
     "label": "How did you handle a coworker or boss you never got along with? How do you think that person would describe you?", "description": null},
    {"id": "sense_of_urgency", "type": "long_text", "required": false, "options": [],
     "label": "What does it mean to have a sense of urgency?", "description": null},

    {"id": "growth_section", "type": "section", "required": false, "options": [], "label": "Future growth", "description": null},
    {"id": "professional_goals", "type": "long_text", "required": false, "options": [],
     "label": "What are your professional goals? Where do you see yourself professionally in 2 years?", "description": null},
    {"id": "strengths", "type": "long_text", "required": false, "options": [],
     "label": "Describe your strengths.", "description": null},
    {"id": "weaknesses", "type": "long_text", "required": false, "options": [],
     "label": "Describe your weaknesses.", "description": null},

    {"id": "next_steps_section", "type": "section", "required": false, "options": [], "label": "Next steps", "description": null},
    {"id": "shadow_availability", "type": "long_text", "required": false, "options": [],
     "label": "Availability for an in-person / shadow interview",
     "description": "Days and times that work, and anything they need to leave by."}
  ]$json$::jsonb,
  '{}'::text[],
  array['phone_screen', 'virtual'],
  false
where not exists (select 1 from recruiting_form where name = 'Phone Screen Interview Guide');

insert into recruiting_form (kind, name, description, intro, fields, job_titles, interview_types, require_resume)
select
  'interview',
  'In-Person / Shadow Day Interview Guide',
  'Loads for in-person interviews and shadow (working interview) days.',
  $t$Before the visit, send the shadow invite (date, time, dark-colored scrubs, who to ask for, and parking). During the visit, the shadow host and the interviewer both add notes. Rate each value from 1 to 5: 1 = concern, 3 = meets expectations, 5 = outstanding.$t$,
  $json$[
    {"id": "arrival_section", "type": "section", "required": false, "options": [], "label": "Arrival & first impressions", "description": null},
    {"id": "on_time", "type": "yes_no", "required": false, "options": [], "label": "Arrived on time?", "description": null},
    {"id": "attire", "type": "yes_no", "required": false, "options": [], "label": "Dressed as asked (dark-colored scrubs)?", "description": null},
    {"id": "shadow_host", "type": "short_text", "required": false, "options": [], "label": "Who did they shadow? (name and role)", "description": null},
    {"id": "first_impression", "type": "long_text", "required": false, "options": [],
     "label": "First impressions", "description": "Greeting, how they introduced themselves to the team, energy, body language."},

    {"id": "values_section", "type": "section", "required": false, "options": [], "label": "Green Dog values (rate 1–5)",
     "description": "The qualities our most successful team members share."},
    {"id": "rate_integrity", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Integrity: does the right thing; honest about what they don't know", "description": null},
    {"id": "rate_compassion", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Compassion / empathy: with pets, clients, and teammates", "description": null},
    {"id": "rate_accountability", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Accountability: owns mistakes and follows through", "description": null},
    {"id": "rate_reliability", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Reliability: punctual; does what they say they'll do", "description": null},
    {"id": "rate_teachable", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Teachable / growth driven: curious, asks questions, takes direction well", "description": null},
    {"id": "rate_team_player", "type": "multiple_choice", "required": false, "options": ["1", "2", "3", "4", "5"],
     "label": "Team player: jumps in to help and communicates well with staff", "description": null},
    {"id": "values_examples", "type": "long_text", "required": false, "options": [],
     "label": "Examples behind these ratings", "description": null},

    {"id": "floor_section", "type": "section", "required": false, "options": [], "label": "On the floor", "description": null},
    {"id": "engagement", "type": "long_text", "required": false, "options": [],
     "label": "Engagement: did they ask questions, take notes, and stay involved, or hang back or check their phone?", "description": null},
    {"id": "client_interactions", "type": "long_text", "required": false, "options": [],
     "label": "Client interactions observed: tone, empathy, professionalism", "description": null},
    {"id": "animal_handling", "type": "long_text", "required": false, "options": [],
     "label": "Animal handling / clinical skills: comfort and safety with dogs and cats, restraint, skills shown",
     "description": "Clinical roles. Skip for client service roles."},
    {"id": "systems_workflow", "type": "long_text", "required": false, "options": [],
     "label": "Systems & workflow: how quickly they picked up ezyVet, phones, check-in/out, or the treatment flow", "description": null},
    {"id": "under_pressure", "type": "long_text", "required": false, "options": [],
     "label": "How did they handle a busy or stressful moment?", "description": null},

    {"id": "conversation_section", "type": "section", "required": false, "options": [], "label": "Sit-down conversation", "description": null},
    {"id": "after_visit", "type": "long_text", "required": false, "options": [],
     "label": "Now that you've seen a day at Green Dog, what stood out to you? Did anything surprise you?", "description": null},
    {"id": "excited_challenged", "type": "long_text", "required": false, "options": [],
     "label": "What part of this role would you be most excited about, and what would be most challenging for you?", "description": null},
    {"id": "role_scenario", "type": "long_text", "required": false, "options": [],
     "label": "Role scenario: walk me through how you would handle a situation like one we saw today.",
     "description": "CSR: an upset client at check-out. Tech: a fractious patient during a procedure. Remote CSR: a post-op concern call."},
    {"id": "critical_feedback", "type": "long_text", "required": false, "options": [],
     "label": "Tell me about a time you received critical feedback. What did you do with it?", "description": null},
    {"id": "candidate_questions", "type": "long_text", "required": false, "options": [],
     "label": "Questions the candidate asked", "description": null},

    {"id": "team_section", "type": "section", "required": false, "options": [], "label": "Team feedback", "description": null},
    {"id": "team_feedback", "type": "long_text", "required": false, "options": [],
     "label": "Feedback from the shadow host and team", "description": "Who said what."},
    {"id": "concerns", "type": "long_text", "required": false, "options": [],
     "label": "Concerns or red flags", "description": null}
  ]$json$::jsonb,
  '{}'::text[],
  array['in_person', 'working_interview'],
  false
where not exists (select 1 from recruiting_form where name = 'In-Person / Shadow Day Interview Guide');

insert into recruiting_form (kind, name, description, intro, fields, job_titles, interview_types, require_resume)
select
  'interview',
  'Final Interview Guide',
  'Loads for final interviews with the hiring manager or clinical director.',
  $t$Read the phone screen and shadow-day notes first. Resolve every open question before an offer. Set Recommendation to Advance to move the candidate to Offer.$t$,
  $json$[
    {"id": "review_section", "type": "section", "required": false, "options": [], "label": "Earlier rounds", "description": null},
    {"id": "open_items", "type": "long_text", "required": false, "options": [],
     "label": "Open items from earlier rounds and how they were resolved",
     "description": "Concerns, unconfirmed details (software, schedule, references), anything the shadow team flagged."},

    {"id": "values_section", "type": "section", "required": false, "options": [], "label": "Values & culture", "description": null},
    {"id": "why_green_dog", "type": "long_text", "required": false, "options": [],
     "label": "Why Green Dog, and why now? What would make this a long-term career for you?", "description": null},
    {"id": "team_culture", "type": "long_text", "required": false, "options": [],
     "label": "Green Dog is an employee-first practice. What does a great team culture look like to you, and how do you contribute to it?", "description": null},
    {"id": "integrity_example", "type": "long_text", "required": false, "options": [],
     "label": "Tell me about a time you did the right thing even though it was hard.", "description": null},
    {"id": "mistake_example", "type": "long_text", "required": false, "options": [],
     "label": "Tell me about a mistake you made at work. How did you handle it?", "description": null},
    {"id": "learning", "type": "long_text", "required": false, "options": [],
     "label": "What have you learned recently, and what do you want to learn next?", "description": null},
    {"id": "managed_how", "type": "long_text", "required": false, "options": [],
     "label": "How do you like to be managed, and how do you like to receive feedback?", "description": null},

    {"id": "role_section", "type": "section", "required": false, "options": [], "label": "Role & expectations", "description": null},
    {"id": "expectations_reviewed", "type": "yes_no", "required": false, "options": [],
     "label": "Reviewed the role's duties, schedule, and expectations with the candidate?",
     "description": "Schedules aren't fixed, cross-location coverage, time-off policy, and the review timeline."},
    {"id": "schedule_confirmed", "type": "long_text", "required": false, "options": [],
     "label": "Schedule, days, and hours confirmed", "description": null},
    {"id": "locations_confirmed", "type": "checkboxes", "required": false,
     "options": ["Sherman Oaks", "Van Nuys", "Venice", "Remote"],
     "label": "Locations confirmed", "description": null},
    {"id": "first_90_days", "type": "long_text", "required": false, "options": [],
     "label": "What would success look like for you in your first 90 days?", "description": null},

    {"id": "offer_section", "type": "section", "required": false, "options": [], "label": "Offer details", "description": null},
    {"id": "pay_expectation", "type": "short_text", "required": false, "options": [],
     "label": "Pay expectation", "description": null},
    {"id": "pay_discussed", "type": "long_text", "required": false, "options": [],
     "label": "Compensation discussed", "description": "Starting rate, review timeline, anything promised."},
    {"id": "start_date", "type": "date", "required": false, "options": [],
     "label": "Earliest start date", "description": null},
    {"id": "notice_period", "type": "short_text", "required": false, "options": [],
     "label": "Notice owed to current employer", "description": null},
    {"id": "other_offers", "type": "long_text", "required": false, "options": [],
     "label": "Other offers or interviews in progress", "description": null},
    {"id": "references", "type": "multiple_choice", "required": false,
     "options": ["Not requested yet", "Requested", "Checked: positive", "Checked: concerns"],
     "label": "References", "description": null},
    {"id": "candidate_questions", "type": "long_text", "required": false, "options": [],
     "label": "Candidate's questions and our answers", "description": null},

    {"id": "decision_section", "type": "section", "required": false, "options": [], "label": "Decision", "description": null},
    {"id": "decision_notes", "type": "long_text", "required": false, "options": [],
     "label": "Hiring decision notes", "description": "Who was involved in the decision and why."}
  ]$json$::jsonb,
  '{}'::text[],
  array['final'],
  false
where not exists (select 1 from recruiting_form where name = 'Final Interview Guide');

commit;
