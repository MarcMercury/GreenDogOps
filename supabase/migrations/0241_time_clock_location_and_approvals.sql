-- ============================================================================
-- Green Dog Ops — 0241 Time clock: location check, off-site approval, queues
-- ----------------------------------------------------------------------------
-- Gate 1 item 5 (go-live plan D6, D9, §F).
--
-- 1. Clinic location settings (configured in Admin ▸ Time Clock, item 6):
--      location.latitude/longitude, geofence_radius_m (150), gps_max_accuracy_m
--      (100), clock_policy (network_or_geofence | network_only | geofence_only
--      | anywhere_logged; mobile locations default to anywhere_logged), and
--      location_network: approved public IPs / ranges, many per clinic.
--    The check itself is src/lib/timeclock/location-check.ts; its result and
--    evidence are stored on the punch. A clinic with no geofence and no
--    network cannot be judged, so its punches stay 'not_checked' — nothing goes
--    to approval before the clinics are configured.
-- 2. time_punch gains matched_location_id, network_id, distance_m and
--    needs_approval (= an off-site punch). An off-site punch REQUIRES a note
--    and is never refused (D6).
-- 3. time_punch_adjustment (append-only): 'add' a punch or 'void' a punch /
--    earlier add, always with a reason and who did it. Punches themselves are
--    never edited. The effective timecard = punches − voids + adds.
-- 4. time_punch_review (append-only, one per punch): an approver's decision on
--    an off-site punch. Rejecting voids the punch in the same transaction.
-- 5. record_time_punch() (replaces the 0240 version; extra parameters all
--    default, so older callers resolve unchanged) works on the EFFECTIVE
--    punches, so a manager-added clock-out closes the session. It also lets
--    someone who forgot to clock out start a new shift once their last punch
--    is more than 8 hours old (p_abandon_previous); the old session then
--    shows as a missing clock-out.
-- 6. review_time_punch() and decide_time_correction(): atomic approver
--    actions (service role only; the app checks the approver role, D9).
--
-- All new tables are service-role only (payroll data; network list is
-- security configuration) and keep the 0239 Staff read-only policies.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- 1. ------------------------------------------------------------------------
alter table greendogops.location
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geofence_radius_m integer not null default 150,
  add column if not exists gps_max_accuracy_m integer not null default 100,
  add column if not exists clock_policy text not null default 'network_or_geofence';

alter table greendogops.location
  add constraint location_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint location_longitude_range check (longitude is null or longitude between -180 and 180),
  add constraint location_latlng_pair check ((latitude is null) = (longitude is null)),
  add constraint location_geofence_radius_range check (geofence_radius_m between 25 and 5000),
  add constraint location_gps_accuracy_range check (gps_max_accuracy_m between 5 and 5000),
  add constraint location_clock_policy_chk
    check (clock_policy in ('network_or_geofence', 'network_only', 'geofence_only', 'anywhere_logged'));

comment on column greendogops.location.clock_policy is
  'Time-clock location rule (0241): network_or_geofence (default), network_only, geofence_only, anywhere_logged (mobile: always accepted, GPS recorded).';

update greendogops.location set clock_policy = 'anywhere_logged' where kind = 'mobile';

create table greendogops.location_network (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references greendogops.location(id),
  label            text not null check (length(btrim(label)) > 0),
  cidr             cidr not null,
  is_active        boolean not null default true,
  added_by         uuid,
  added_via        text not null default 'manual' check (added_via in ('manual', 'captured')),
  last_matched_at  timestamptz,
  match_count      integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (location_id, cidr)
);

comment on table greendogops.location_network is
  'Approved public networks (static IP /32 or a range) per clinic for the time clock (0241). Deactivate rather than delete. Service role only.';

create trigger set_updated_at before update on greendogops.location_network
  for each row execute function greendogops.set_updated_at();

-- 2. ------------------------------------------------------------------------
alter table greendogops.time_punch
  add column matched_location_id uuid references greendogops.location(id),
  add column network_id uuid references greendogops.location_network(id),
  add column distance_m double precision,
  add column needs_approval boolean not null default false;

alter table greendogops.time_punch
  add constraint time_punch_offsite_needs_note
    check (location_check <> 'off_site' or length(btrim(coalesce(note, ''))) > 0),
  add constraint time_punch_needs_approval_offsite
    check (needs_approval = (location_check = 'off_site'));

comment on column greendogops.time_punch.needs_approval is
  'Off-site punch (location check failed, employee chose "Working off-site" with a note). Pending until a time_punch_review row exists.';

create index time_punch_needs_approval_idx on greendogops.time_punch (punched_at) where needs_approval;

-- 3. ------------------------------------------------------------------------
create function greendogops.time_record_append_only() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
begin
  raise exception 'greendogops.% is append-only (% blocked)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create table greendogops.time_punch_adjustment (
  id                     uuid primary key default gen_random_uuid(),
  person_id              uuid not null references greendogops.person(id),
  action                 text not null check (action in ('add', 'void')),
  punch_type             text check (punch_type in ('clock_in', 'lunch_start', 'lunch_end', 'clock_out')),
  punched_at             timestamptz,
  work_date              date not null,
  voids_punch_id         uuid references greendogops.time_punch(id),
  voids_adjustment_id    uuid references greendogops.time_punch_adjustment(id),
  reason                 text not null check (length(btrim(reason)) > 0),
  correction_request_id  uuid references greendogops.time_correction_request(id),
  created_by             uuid,
  created_at             timestamptz not null default now(),
  constraint time_punch_adjustment_shape check (
    (action = 'add' and punch_type is not null and punched_at is not null
       and voids_punch_id is null and voids_adjustment_id is null)
    or
    (action = 'void' and punch_type is null and punched_at is null
       and num_nonnulls(voids_punch_id, voids_adjustment_id) = 1)
  ),
  constraint time_punch_adjustment_not_future check (punched_at is null or punched_at <= created_at + interval '1 minute')
);

comment on table greendogops.time_punch_adjustment is
  'Approver changes to a timecard (0241): add a punch, or void a punch / earlier add. Append-only; reason required. Effective punches = time_punch − voids + adds. Service role only; keep 4 years.';

create unique index time_punch_adjustment_void_punch_uq
  on greendogops.time_punch_adjustment (voids_punch_id) where voids_punch_id is not null;
create unique index time_punch_adjustment_void_adj_uq
  on greendogops.time_punch_adjustment (voids_adjustment_id) where voids_adjustment_id is not null;
create index time_punch_adjustment_person_idx on greendogops.time_punch_adjustment (person_id, work_date);

create trigger time_punch_adjustment_append_only_row
  before update or delete on greendogops.time_punch_adjustment
  for each row execute function greendogops.time_record_append_only();
create trigger time_punch_adjustment_append_only_truncate
  before truncate on greendogops.time_punch_adjustment
  for each statement execute function greendogops.time_record_append_only();

-- 4. ------------------------------------------------------------------------
create table greendogops.time_punch_review (
  punch_id     uuid primary key references greendogops.time_punch(id),
  decision     text not null check (decision in ('approved', 'rejected')),
  note         text,
  reviewed_by  uuid,
  reviewed_at  timestamptz not null default now(),
  constraint time_punch_review_reject_note
    check (decision = 'approved' or length(btrim(coalesce(note, ''))) > 0)
);

comment on table greendogops.time_punch_review is
  'Approver decision on an off-site punch (0241). One per punch, append-only. Rejecting also voids the punch (time_punch_adjustment). Service role only.';

create trigger time_punch_review_append_only_row
  before update or delete on greendogops.time_punch_review
  for each row execute function greendogops.time_record_append_only();
create trigger time_punch_review_append_only_truncate
  before truncate on greendogops.time_punch_review
  for each statement execute function greendogops.time_record_append_only();

do $$
declare
  t text;
begin
  foreach t in array array['location_network', 'time_punch_adjustment', 'time_punch_review']
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

-- 5. ------------------------------------------------------------------------
-- Effective punches for one person: punches not voided, plus adds not voided.
create function greendogops.time_effective_punches(p_person_id uuid)
  returns table (
    id uuid, punch_type text, punched_at timestamptz, work_date date,
    location_id uuid, assignment_id uuid, created_at timestamptz
  )
  language sql stable
  set search_path to 'greendogops', 'pg_catalog'
as $$
  select p.id, p.punch_type, p.punched_at, p.work_date, p.location_id, p.assignment_id, p.created_at
    from greendogops.time_punch p
   where p.person_id = p_person_id
     and not exists (select 1 from greendogops.time_punch_adjustment v where v.voids_punch_id = p.id)
  union all
  select a.id, a.punch_type, a.punched_at, a.work_date, null, null, a.created_at
    from greendogops.time_punch_adjustment a
   where a.person_id = p_person_id
     and a.action = 'add'
     and not exists (select 1 from greendogops.time_punch_adjustment v where v.voids_adjustment_id = a.id);
$$;

revoke all on function greendogops.time_effective_punches(uuid) from public, anon, authenticated;
grant execute on function greendogops.time_effective_punches(uuid) to service_role;

drop function if exists greendogops.record_time_punch(
  uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision,
  double precision, timestamptz, text, boolean, text, text);

create function greendogops.record_time_punch(
  p_person_id            uuid,
  p_punch_type           text,
  p_source               text default 'self',
  p_created_by           uuid default null,
  p_location_id          uuid default null,
  p_assignment_id        uuid default null,
  p_ip                   text default null,
  p_user_agent           text default null,
  p_latitude             double precision default null,
  p_longitude            double precision default null,
  p_accuracy_m           double precision default null,
  p_client_time          timestamptz default null,
  p_note                 text default null,
  p_rest_breaks_ok       boolean default null,
  p_location_check       text default 'not_checked',
  p_timezone             text default 'America/Los_Angeles',
  p_matched_location_id  uuid default null,
  p_network_id           uuid default null,
  p_distance_m           double precision default null,
  p_abandon_previous     boolean default false
) returns jsonb
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_now        timestamptz;
  v_last       record;
  v_session    record;
  v_state      text;
  v_work_date  date;
  v_location   uuid := p_location_id;
  v_assignment uuid := p_assignment_id;
  v_check      text := coalesce(p_location_check, 'not_checked');
  v_note       text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_id         uuid;
begin
  if p_punch_type not in ('clock_in', 'lunch_start', 'lunch_end', 'clock_out') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  if v_check not in ('not_checked', 'on_site', 'other_clinic', 'off_site') then
    return jsonb_build_object('ok', false, 'error', 'invalid_location_check');
  end if;
  if v_check = 'off_site' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'note_required');
  end if;

  perform 1
    from greendogops.person p
   where p.id = p_person_id
     and p.is_active
     and p.status::text in ('employee', 'contractor');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  -- One punch at a time per person; the time is read after the lock.
  perform pg_advisory_xact_lock(hashtextextended('time_punch:' || p_person_id::text, 0));
  v_now := clock_timestamp();

  select e.* into v_last
    from greendogops.time_effective_punches(p_person_id) e
   order by e.punched_at desc, e.created_at desc
   limit 1;

  -- A double tap is the same punch, not a second one.
  if v_last.id is not null
     and v_last.punch_type = p_punch_type
     and v_now - v_last.punched_at < interval '60 seconds' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'punch_id', v_last.id,
                              'punched_at', v_last.punched_at, 'work_date', v_last.work_date,
                              'punch_type', v_last.punch_type);
  end if;

  -- Mirrors clockState() in src/lib/timeclock/state.ts.
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
    -- Forgot to clock out: start a new shift once the last punch is > 8 h old.
    or (v_state in ('working', 'on_lunch') and p_punch_type = 'clock_in'
        and coalesce(p_abandon_previous, false)
        and v_now - v_last.punched_at > interval '8 hours')
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition', 'state', v_state);
  end if;

  if p_rest_breaks_ok is not null and p_punch_type <> 'clock_out' then
    return jsonb_build_object('ok', false, 'error', 'rest_breaks_only_on_clock_out');
  end if;

  if p_punch_type = 'clock_in' then
    v_work_date := (v_now at time zone p_timezone)::date;
  else
    select e.* into v_session
      from greendogops.time_effective_punches(p_person_id) e
     where e.punch_type = 'clock_in'
     order by e.punched_at desc, e.created_at desc
     limit 1;
    v_work_date := coalesce(v_session.work_date, (v_now at time zone p_timezone)::date);
    v_location := coalesce(v_location, v_session.location_id);
    v_assignment := coalesce(v_assignment, v_session.assignment_id);
  end if;

  insert into greendogops.time_punch (
    person_id, punch_type, punched_at, work_date, location_id, assignment_id, source,
    ip, user_agent, latitude, longitude, accuracy_m, location_check, note,
    rest_breaks_ok, client_time, created_by,
    matched_location_id, network_id, distance_m, needs_approval
  ) values (
    p_person_id, p_punch_type, v_now, v_work_date, v_location, v_assignment,
    coalesce(p_source, 'self'), left(p_ip, 100), left(p_user_agent, 300),
    p_latitude, p_longitude, p_accuracy_m, v_check, v_note,
    p_rest_breaks_ok, p_client_time, p_created_by,
    p_matched_location_id, p_network_id, p_distance_m, v_check = 'off_site'
  )
  returning id into v_id;

  if p_network_id is not null then
    update greendogops.location_network
       set last_matched_at = v_now, match_count = match_count + 1
     where id = p_network_id;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'punch_id', v_id,
                            'punched_at', v_now, 'work_date', v_work_date,
                            'punch_type', p_punch_type, 'needs_approval', v_check = 'off_site');
end;
$$;

comment on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text, uuid, uuid, double precision, boolean) is
  'The only writer of time_punch (0240, 0241): per-person lock, state check on EFFECTIVE punches (adjustments applied), double-tap idempotency, server time, clinic-time-zone work_date, off-site punches need a note and go to approval. Service role only.';

revoke all on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text, uuid, uuid, double precision, boolean) from public, anon, authenticated;
grant execute on function greendogops.record_time_punch(uuid, text, text, uuid, uuid, uuid, text, text, double precision, double precision, double precision, timestamptz, text, boolean, text, text, uuid, uuid, double precision, boolean) to service_role;

-- 6. ------------------------------------------------------------------------
create function greendogops.review_time_punch(
  p_punch_id  uuid,
  p_decision  text,
  p_note      text,
  p_reviewer  uuid
) returns jsonb
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_punch greendogops.time_punch%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'invalid_decision');
  end if;
  if p_decision = 'rejected' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'note_required');
  end if;

  select * into v_punch from greendogops.time_punch where id = p_punch_id;
  if v_punch.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not v_punch.needs_approval then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  insert into greendogops.time_punch_review (punch_id, decision, note, reviewed_by)
  values (p_punch_id, p_decision, v_note, p_reviewer)
  on conflict (punch_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_reviewed');
  end if;

  if p_decision = 'rejected' then
    insert into greendogops.time_punch_adjustment
      (person_id, action, work_date, voids_punch_id, reason, created_by)
    values
      (v_punch.person_id, 'void', v_punch.work_date, v_punch.id,
       'Off-site punch rejected: ' || v_note, p_reviewer)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'person_id', v_punch.person_id);
end;
$$;

create function greendogops.decide_time_correction(
  p_request_id            uuid,
  p_decision              text,
  p_note                  text,
  p_reviewer              uuid,
  p_replace_punch_id      uuid default null,
  p_replace_adjustment_id uuid default null
) returns jsonb
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_req   greendogops.time_correction_request%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_owner uuid;
  v_reason text;
begin
  if p_decision not in ('approved', 'denied') then
    return jsonb_build_object('ok', false, 'error', 'invalid_decision');
  end if;

  select * into v_req from greendogops.time_correction_request where id = p_request_id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  if p_decision = 'denied' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'note_required');
  end if;

  if p_decision = 'approved' and v_req.kind in ('missing_punch', 'wrong_time') then
    if v_req.requested_time > clock_timestamp() then
      return jsonb_build_object('ok', false, 'error', 'future_time');
    end if;
    v_reason := 'Correction request: ' || v_req.reason;

    if v_req.kind = 'wrong_time' then
      if num_nonnulls(p_replace_punch_id, p_replace_adjustment_id) <> 1 then
        return jsonb_build_object('ok', false, 'error', 'replace_target_required');
      end if;
      if p_replace_punch_id is not null then
        select person_id into v_owner from greendogops.time_punch where id = p_replace_punch_id;
      else
        select person_id into v_owner from greendogops.time_punch_adjustment
         where id = p_replace_adjustment_id and action = 'add';
      end if;
      if v_owner is distinct from v_req.person_id then
        return jsonb_build_object('ok', false, 'error', 'replace_target_invalid');
      end if;
      begin
        insert into greendogops.time_punch_adjustment
          (person_id, action, work_date, voids_punch_id, voids_adjustment_id, reason,
           correction_request_id, created_by)
        values
          (v_req.person_id, 'void', v_req.work_date, p_replace_punch_id, p_replace_adjustment_id,
           v_reason, v_req.id, p_reviewer);
      exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'already_voided');
      end;
    end if;

    insert into greendogops.time_punch_adjustment
      (person_id, action, punch_type, punched_at, work_date, reason, correction_request_id, created_by)
    values
      (v_req.person_id, 'add', v_req.punch_type, v_req.requested_time, v_req.work_date,
       v_reason, v_req.id, p_reviewer);
  end if;

  update greendogops.time_correction_request
     set status = p_decision, reviewed_by = p_reviewer, reviewed_at = now(), review_note = v_note
   where id = v_req.id;

  return jsonb_build_object('ok', true, 'person_id', v_req.person_id);
end;
$$;

revoke all on function greendogops.review_time_punch(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function greendogops.review_time_punch(uuid, text, text, uuid) to service_role;
revoke all on function greendogops.decide_time_correction(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function greendogops.decide_time_correction(uuid, text, text, uuid, uuid, uuid) to service_role;
revoke all on function greendogops.time_record_append_only() from public, anon, authenticated;

comment on function greendogops.review_time_punch(uuid, text, text, uuid) is
  'Approve or reject an off-site punch (0241). Reject needs a note and voids the punch. Idempotent per punch. Service role only; the app checks the approver role (D9).';
comment on function greendogops.decide_time_correction(uuid, text, text, uuid, uuid, uuid) is
  'Approve or deny a time_correction_request (0241). Approving a missing punch adds it; a wrong time voids the chosen punch and adds the corrected one. Deny needs a note. Service role only; the app checks the approver role (D9).';

commit;
