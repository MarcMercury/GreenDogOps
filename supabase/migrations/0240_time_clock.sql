-- ============================================================================
-- Green Dog Ops — 0240 Time clock: punches, corrections, privacy notice
-- ----------------------------------------------------------------------------
-- Ops becomes the payroll timekeeping system (go-live plan, Gate 1 items 4–5).
-- Everyone punches from their own phone or computer at /me (My Time).
--
--   time_punch               one row per punch. APPEND-ONLY: a trigger blocks
--                            UPDATE / DELETE / TRUNCATE for every role, the
--                            service role included. Corrections never edit a
--                            punch; an approved correction will add an
--                            adjustment record (item 5). The time is always
--                            the server's now(); the device clock is stored
--                            only for reference (client_time).
--   time_correction_request  "I forgot to clock out" etc., from the employee,
--                            reviewed by an approver (queue: item 5).
--   time_clock_notice_ack    the employee read the time-clock privacy notice
--                            (what is collected and why) — required before the
--                            first punch, per notice version.
--   record_time_punch()      the only way to write a punch: takes a per-person
--                            advisory lock, re-derives the clock state from the
--                            person's last punch, rejects invalid transitions,
--                            treats a repeat of the same punch within 60 s as
--                            the same punch (double tap), and stamps work_date
--                            in the clinics' time zone (later punches inherit
--                            the session's clock-in date, so overnight shifts
--                            stay on one day). Mirrors src/lib/timeclock/state.ts.
--
-- Location evidence (IP, user agent, GPS + accuracy) is captured only at the
-- moment of a punch. location_check stays 'not_checked' until the clinic
-- geofences / networks exist (Admin ▸ Time Clock, items 5–6).
--
-- Retention: 4 years from the end of the pay period (D10). Nothing here
-- deletes; a purge job, if ever enabled, must respect that.
--
-- All three tables are service-role only (personal and payroll data). The app
-- reads and writes them in Server Actions scoped to the signed-in person.
-- ============================================================================

set search_path = greendogops, public;

begin;

create table greendogops.time_punch (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references greendogops.person(id),
  punch_type       text not null
                   check (punch_type in ('clock_in', 'lunch_start', 'lunch_end', 'clock_out')),
  punched_at       timestamptz not null default now(),
  work_date        date not null,
  location_id      uuid references greendogops.location(id),
  -- No FK: shifts are deleted and rebuilt routinely, and ON DELETE SET NULL
  -- would UPDATE this append-only table (blocked). Soft reference only.
  assignment_id    uuid,
  source           text not null default 'self'
                   check (source in ('self', 'manager', 'kiosk')),
  ip               text,
  user_agent       text,
  latitude         double precision,
  longitude        double precision,
  accuracy_m       double precision,
  location_check   text not null default 'not_checked'
                   check (location_check in ('not_checked', 'on_site', 'other_clinic', 'off_site')),
  note             text,
  rest_breaks_ok   boolean,
  client_time      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  constraint time_punch_rest_breaks_on_clock_out
    check (rest_breaks_ok is null or punch_type = 'clock_out')
);

comment on table greendogops.time_punch is
  'Time-clock punches (0240). Append-only: UPDATE/DELETE/TRUNCATE are blocked for every role. punched_at is server time. Written only by record_time_punch(). Personal + payroll data: service role only; keep 4 years after the pay period ends.';
comment on column greendogops.time_punch.work_date is
  'Clinic-time-zone date of the session''s clock-in (later punches inherit it).';
comment on column greendogops.time_punch.client_time is
  'The device clock at the moment of the punch — reference only, never used for pay.';
comment on column greendogops.time_punch.rest_breaks_ok is
  'Clock-out answer to "Were you able to take your rest breaks today?" (non-exempt only). false flags a rest premium for review.';

create index time_punch_person_time_idx on greendogops.time_punch (person_id, punched_at desc);
create index time_punch_work_date_idx on greendogops.time_punch (work_date);

create function greendogops.time_punch_append_only() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
begin
  raise exception 'greendogops.time_punch is append-only (% blocked); record a correction instead', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger time_punch_append_only_row
  before update or delete on greendogops.time_punch
  for each row execute function greendogops.time_punch_append_only();
create trigger time_punch_append_only_truncate
  before truncate on greendogops.time_punch
  for each statement execute function greendogops.time_punch_append_only();

create table greendogops.time_correction_request (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references greendogops.person(id),
  work_date        date not null,
  kind             text not null check (kind in ('missing_punch', 'wrong_time', 'other')),
  punch_type       text check (punch_type in ('clock_in', 'lunch_start', 'lunch_end', 'clock_out')),
  requested_time   timestamptz,
  punch_id         uuid references greendogops.time_punch(id),
  reason           text not null check (length(btrim(reason)) > 0),
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint time_correction_needs_time
    check (kind = 'other' or (punch_type is not null and requested_time is not null))
);

comment on table greendogops.time_correction_request is
  'Employee requests to fix their own punches (0240). Approval never edits time_punch; it records an adjustment (item 5). Service role only; keep 4 years.';

create index time_correction_person_idx on greendogops.time_correction_request (person_id, created_at desc);
create index time_correction_pending_idx on greendogops.time_correction_request (created_at) where status = 'pending';

create trigger set_updated_at before update on greendogops.time_correction_request
  for each row execute function greendogops.set_updated_at();

create table greendogops.time_clock_notice_ack (
  person_id        uuid not null references greendogops.person(id),
  notice_version   text not null,
  acknowledged_at  timestamptz not null default now(),
  app_user_id      uuid,
  ip               text,
  user_agent       text,
  primary key (person_id, notice_version)
);

comment on table greendogops.time_clock_notice_ack is
  'Employee acknowledged the time-clock privacy notice (version = TIME_CLOCK_NOTICE_VERSION in src/lib/timeclock/notice.ts). Required before the first punch. Service role only.';

-- Service role only (personal and payroll data). protect_new_objects() added
-- gdo_members_all; drop it (lessons.md) and keep the 0239 Staff policies.
do $$
declare
  t text;
begin
  foreach t in array array['time_punch', 'time_correction_request', 'time_clock_notice_ack']
  loop
    execute format('alter table greendogops.%I enable row level security', t);
    execute format('drop policy if exists gdo_members_all on greendogops.%I', t);
    execute format('drop policy if exists service_role_only on greendogops.%I', t);
    execute format(
      'create policy service_role_only on greendogops.%I for all to authenticated using (false) with check (false)',
      t
    );
    execute format('revoke all on greendogops.%I from anon, authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- record_time_punch(): the only writer of time_punch.
-- ---------------------------------------------------------------------------
create or replace function greendogops.record_time_punch(
  p_person_id      uuid,
  p_punch_type     text,
  p_source         text default 'self',
  p_created_by     uuid default null,
  p_location_id    uuid default null,
  p_assignment_id  uuid default null,
  p_ip             text default null,
  p_user_agent     text default null,
  p_latitude       double precision default null,
  p_longitude      double precision default null,
  p_accuracy_m     double precision default null,
  p_client_time    timestamptz default null,
  p_note           text default null,
  p_rest_breaks_ok boolean default null,
  p_location_check text default 'not_checked',
  p_timezone       text default 'America/Los_Angeles'
) returns jsonb
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_now        timestamptz;
  v_last       greendogops.time_punch%rowtype;
  v_session    greendogops.time_punch%rowtype;
  v_state      text;
  v_work_date  date;
  v_location   uuid := p_location_id;
  v_assignment uuid := p_assignment_id;
  v_id         uuid;
begin
  if p_punch_type not in ('clock_in', 'lunch_start', 'lunch_end', 'clock_out') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;

  perform 1
    from greendogops.person p
   where p.id = p_person_id
     and p.is_active
     and p.status::text in ('employee', 'contractor');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  -- One punch at a time per person. The punch time is read AFTER the lock
  -- (clock_timestamp, not now(): now() is the transaction start, so a punch
  -- that waited for the lock could otherwise sort before the one it waited on).
  perform pg_advisory_xact_lock(hashtextextended('time_punch:' || p_person_id::text, 0));
  v_now := clock_timestamp();

  select * into v_last
    from greendogops.time_punch
   where person_id = p_person_id
   order by punched_at desc, created_at desc
   limit 1;

  -- A double tap is the same punch, not a second one.
  if v_last.id is not null
     and v_last.punch_type = p_punch_type
     and v_now - v_last.punched_at < interval '60 seconds' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'punch_id', v_last.id,
                              'punched_at', v_last.punched_at, 'work_date', v_last.work_date,
                              'punch_type', v_last.punch_type);
  end if;

  -- Clock state (mirrors clockState() in src/lib/timeclock/state.ts). A
  -- session idle for more than 16 hours is abandoned (missing clock-out).
  v_state := case
    when v_last.id is null or v_last.punch_type = 'clock_out' then 'off'
    when v_now - v_last.punched_at > interval '16 hours' then 'off'
    when v_last.punch_type = 'lunch_start' then 'on_lunch'
    else 'working'
  end;

  if not (
       (v_state = 'off'      and p_punch_type = 'clock_in')
    or (v_state = 'working'  and p_punch_type in ('lunch_start', 'clock_out'))
    or (v_state = 'on_lunch' and p_punch_type in ('lunch_end', 'clock_out'))
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition', 'state', v_state);
  end if;

  if p_rest_breaks_ok is not null and p_punch_type <> 'clock_out' then
    return jsonb_build_object('ok', false, 'error', 'rest_breaks_only_on_clock_out');
  end if;

  if p_punch_type = 'clock_in' then
    v_work_date := (v_now at time zone p_timezone)::date;
  else
    select * into v_session
      from greendogops.time_punch
     where person_id = p_person_id
       and punch_type = 'clock_in'
     order by punched_at desc, created_at desc
     limit 1;
    v_work_date := coalesce(v_session.work_date, (v_now at time zone p_timezone)::date);
    v_location := coalesce(v_location, v_session.location_id);
    v_assignment := coalesce(v_assignment, v_session.assignment_id);
  end if;

  insert into greendogops.time_punch (
    person_id, punch_type, punched_at, work_date, location_id, assignment_id, source,
    ip, user_agent, latitude, longitude, accuracy_m, location_check, note,
    rest_breaks_ok, client_time, created_by
  ) values (
    p_person_id, p_punch_type, v_now, v_work_date, v_location, v_assignment,
    coalesce(p_source, 'self'), left(p_ip, 100), left(p_user_agent, 300),
    p_latitude, p_longitude, p_accuracy_m, coalesce(p_location_check, 'not_checked'),
    nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_rest_breaks_ok, p_client_time, p_created_by
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'punch_id', v_id,
                            'punched_at', v_now, 'work_date', v_work_date,
                            'punch_type', p_punch_type);
end;
$$;

comment on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text) is
  'The only writer of time_punch (0240): per-person lock, state check, double-tap idempotency, server time, clinic-time-zone work_date. Returns {ok, error?, state?, duplicate, punch_id, punched_at, work_date}. Service role only.';

revoke all on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text) from public, anon, authenticated;
grant execute on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text) to service_role;
revoke all on function greendogops.time_punch_append_only() from public, anon, authenticated;

commit;
