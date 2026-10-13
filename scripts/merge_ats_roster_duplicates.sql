-- Merge duplicate ATS applicants into the roster person they already are.
--
-- Someone on the roster (employee / former) who applies again, or is imported
-- again, ends up as a second `person` (status = applicant) because applicant
-- intake only de-dupes against other applicants. This folds each such
-- applicant into the roster person and removes the applicant, so they leave the
-- ATS and their application history follows them onto the HR profile.
--
-- 1. Find candidate pairs (read-only) with the FIND query below and review
--    every pair by hand — phone/name matches need a human check.
-- 2. Back up the applicants and their rows (see docs/agent/lessons.md).
-- 3. Replace /*PAIRS*/ with the reviewed pairs, e.g.
--      array[['<applicant id>','<roster person id>'], …]
--    and run the file. It is one DO block, so it is all-or-nothing, and it
--    refuses any pair that is not applicant → employee/former.
--
-- Per pair:
--   * every row pointing at the applicant (documents, interviews, invites,
--     forms, rejections, tasks, activity, score history, transition log, …) is
--     re-pointed at the roster person — discovered from the foreign keys, so new
--     tables are covered automatically;
--   * person_recruiting moves over whole when the roster person has none,
--     otherwise blanks are filled from the applicant, application_history is
--     concatenated and the applicant's notes are appended under a header;
--   * current employees end at stage Hired / review accepted;
--   * blank contact fields on the roster person are filled (email only when
--     they have no login — the person trigger copies email onto app_user);
--   * a `merged_duplicate` entry is written to the profile transition log;
--   * the applicant person row is deleted.
-- Storage objects are not moved: person_document rows keep their storage_path
-- (under the old applicant id), which is only ever read through signed URLs.
--
-- FIND (read-only):
--   with p as (
--     select id, status, lower(trim(email)) em,
--       nullif(right(regexp_replace(coalesce(phone_mobile,''),'\D','','g'),10),'') ph,
--       regexp_replace(lower(coalesce(first_name,'')),'[^a-z]','','g') fn,
--       regexp_replace(lower(coalesce(last_name,'')),'[^a-z]','','g') ln
--     from greendogops.person)
--   select a.id applicant_id, e.id roster_id, e.status
--   from p a join p e on e.status in ('employee','former')
--    and ((a.em <> '' and a.em = e.em)
--      or (length(a.ph) = 10 and a.ph = e.ph)
--      or (a.fn <> '' and a.ln <> '' and a.fn = e.fn and a.ln = e.ln))
--   where a.status = 'applicant';

do $merge$
declare
  pairs uuid[] := /*PAIRS*/;
  one_to_one text[] := array[
    'greendogops.person_recruiting', 'greendogops.person_employment',
    'greendogops.app_user', 'greendogops.sched_employee_setting',
    'greendogops.calendar_schedule_pin', 'greendogops.sms_consent',
    'greendogops.person_slack_link'];
  i int;
  a uuid;
  e uuid;
  ap greendogops.person%rowtype;
  ep greendogops.person%rowtype;
  ar greendogops.person_recruiting%rowtype;
  er greendogops.person_recruiting%rowtype;
  fk record;
  hit boolean;
  n int;
  moved text[];
  header text;
  has_login boolean;
begin
  if pairs is null or coalesce(array_length(pairs, 1), 0) = 0 then
    raise exception 'No pairs supplied — fill in the pairs array';
  end if;

  for i in 1 .. array_length(pairs, 1) loop
    a := pairs[i][1];
    e := pairs[i][2];
    moved := array[]::text[];

    select * into ap from greendogops.person where id = a for update;
    select * into ep from greendogops.person where id = e for update;
    if ap.id is null then raise exception 'Pair %: applicant % not found', i, a; end if;
    if ep.id is null then raise exception 'Pair %: roster person % not found', i, e; end if;
    if ap.status <> 'applicant' then
      raise exception 'Pair %: % is %, not an applicant', i, a, ap.status;
    end if;
    if ep.status not in ('employee', 'former') then
      raise exception 'Pair %: % is %, not employee/former', i, e, ep.status;
    end if;

    -- An applicant should never carry roster-only 1:1 rows; stop if one does.
    for fk in
      select c.conrelid::regclass::text tbl, att.attname col
      from pg_constraint c
      join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'greendogops.person'::regclass
        and c.conrelid::regclass::text = any (one_to_one)
        and c.conrelid::regclass::text <> 'greendogops.person_recruiting'
    loop
      execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col)
        into hit using a;
      if hit then raise exception 'Pair %: applicant % has a % row', i, a, fk.tbl; end if;
    end loop;

    -- 1. Recruiting record.
    select * into ar from greendogops.person_recruiting where person_id = a;
    select * into er from greendogops.person_recruiting where person_id = e;
    header := format(
      '[Merged ATS application %s — %s · stage %s · source %s]',
      coalesce(ar.application_date::text, ap.created_at::date::text),
      coalesce(ar.target_title, '?'),
      coalesce(ar.stage, '—'),
      coalesce(ar.source, '—'));
    if ar.person_id is not null then
      if er.person_id is null then
        update greendogops.person_recruiting set person_id = e where person_id = a;
      else
        update greendogops.person_recruiting set
          target_position_id  = coalesce(er.target_position_id, ar.target_position_id),
          pipeline            = coalesce(er.pipeline, ar.pipeline),
          stage               = coalesce(er.stage, ar.stage),
          source              = coalesce(er.source, ar.source),
          interview_date      = coalesce(er.interview_date, ar.interview_date),
          score               = coalesce(er.score, ar.score),
          resume_url          = coalesce(er.resume_url, ar.resume_url),
          keep_for_future     = coalesce(er.keep_for_future, ar.keep_for_future),
          follow_up_date      = coalesce(er.follow_up_date, ar.follow_up_date),
          target_title        = coalesce(er.target_title, ar.target_title),
          application_date    = coalesce(er.application_date, ar.application_date),
          review_status       = coalesce(er.review_status, ar.review_status),
          reviewed_at         = coalesce(er.reviewed_at, ar.reviewed_at),
          reviewed_by         = coalesce(er.reviewed_by, ar.reviewed_by),
          candidate_location  = coalesce(er.candidate_location, ar.candidate_location),
          relevant_experience = coalesce(er.relevant_experience, ar.relevant_experience),
          education           = coalesce(er.education, ar.education),
          job_location        = coalesce(er.job_location, ar.job_location),
          interest_level      = coalesce(er.interest_level, ar.interest_level),
          external_status     = coalesce(er.external_status, ar.external_status),
          source_detail       = coalesce(er.source_detail, ar.source_detail),
          screening_answers   = coalesce(nullif(er.screening_answers, '[]'::jsonb), ar.screening_answers),
          application_history = coalesce(er.application_history, '[]'::jsonb)
                                || coalesce(ar.application_history, '[]'::jsonb),
          application         = coalesce(nullif(er.application, '{}'::jsonb), ar.application),
          slack_announce_ts      = coalesce(er.slack_announce_ts, ar.slack_announce_ts),
          slack_announce_channel = coalesce(er.slack_announce_channel, ar.slack_announce_channel),
          announced_at        = coalesce(er.announced_at, ar.announced_at),
          announced_by        = coalesce(er.announced_by, ar.announced_by),
          status_notes        = case
                                  when ar.status_notes is null
                                    or strpos(coalesce(er.status_notes, ''), ar.status_notes) > 0
                                  then er.status_notes
                                  else concat_ws(E'\n', er.status_notes, ar.status_notes)
                                end,
          notes               = concat_ws(E'\n\n', er.notes, concat_ws(E'\n', header, ar.notes))
        where person_id = e;
        delete from greendogops.person_recruiting where person_id = a;
      end if;
      moved := array_append(moved, 'recruiting record');
    end if;
    if ep.status = 'employee' then
      update greendogops.person_recruiting
        set stage = 'Hired', review_status = 'accepted'
        where person_id = e
          and (stage is distinct from 'Hired' or review_status is distinct from 'accepted');
    else
      update greendogops.person_recruiting
        set review_status = 'accepted'
        where person_id = e and review_status = 'pending';
    end if;

    -- 2. Every other row that points at the applicant.
    for fk in
      select c.conrelid::regclass::text tbl, att.attname col
      from pg_constraint c
      join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'greendogops.person'::regclass
        and array_length(c.conkey, 1) = 1
        and not (c.conrelid::regclass::text = any (one_to_one))
      union all
      select 'greendogops.sched_change_log', 'person_id'
    loop
      -- Only touch tables that hold rows, so append-only triggers never fire.
      execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col)
        into hit using a;
      if hit then
        execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using e, a;
        get diagnostics n = row_count;
        moved := array_append(moved, format('%s %s', n, replace(fk.tbl, 'greendogops.', '')));
      end if;
    end loop;

    -- 3. Fill blank contact fields on the roster person.
    select exists (select 1 from greendogops.app_user where person_id = e) into has_login;
    update greendogops.person set
      email = case
                when email is null and not has_login and ap.email not ilike '%@indeedemail.com'
                then ap.email else email end,
      phone_mobile      = coalesce(phone_mobile, ap.phone_mobile),
      phone_home        = coalesce(phone_home, ap.phone_home),
      phone_other       = coalesce(phone_other, ap.phone_other),
      postal_code       = coalesce(postal_code, ap.postal_code),
      date_of_birth     = coalesce(date_of_birth, ap.date_of_birth),
      preferred_name    = coalesce(preferred_name, ap.preferred_name),
      opportunity_type  = coalesce(opportunity_type, ap.opportunity_type),
      source_contact_id = coalesce(source_contact_id, ap.source_contact_id),
      notes = case
                when ap.notes is null or strpos(coalesce(notes, ''), ap.notes) > 0 then notes
                else concat_ws(E'\n\n', notes, ap.notes) end
    where id = e;

    -- 4. Record the merge on the profile, then remove the applicant.
    insert into greendogops.profile_transition_log
      (person_id, event_type, from_stage, to_stage, detail, actor_name)
    values (
      e, 'merged_duplicate', 'applicant', ep.status,
      format('Duplicate ATS record merged into this profile: %s. Moved: %s.',
             header, coalesce(nullif(array_to_string(moved, ', '), ''), 'nothing else')),
      'Data cleanup');

    delete from greendogops.person where id = a;
    raise notice 'Merged % into % (%)', a, e, array_to_string(moved, ', ');
  end loop;
end
$merge$;
