-- ============================================================================
-- Green Dog Ops — 0242 Meal-period waivers (go-live checklist item 12, plan D14, §J)
-- ----------------------------------------------------------------------------
-- 1. The two waivers are native, versioned policy documents (Resources ▸ HR):
--      7a1f0c2e-…6001  Meal Period Waiver — Workdays of Six Hours or Less
--      7a1f0c2e-…6002  Second Meal Period Waiver — Workdays of Twelve Hours or Less
--    Seeded as DRAFT wording, visible to HR roles only (visible_roles = '{}').
--    HR / payroll review and edit them in the normal editor (new versions).
-- 2. app_setting timeclock.meal_waivers_live (false): My Time offers the
--    waivers only after an Admin turns it on (Admin ▸ Settings).
-- 3. meal_waiver: one row per signature, bound to the exact document version
--    the employee read. Signing is voluntary; revoking sets revoked_at and is
--    the ONLY change allowed (trigger) — rows are never deleted. One active
--    waiver per person and kind. Signed and revoked in My Time.
-- 4. meal_waiver_in_force(person, kind, at): the waiver in force at a moment
--    (signed at or before it, not revoked by then). Payroll uses the shift's
--    time, so revoking never changes past shifts.
--
-- Service role only (HR record). Keep 4 years like other timekeeping records.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- 1. ------------------------------------------------------------------------
insert into greendogops.resource_document
  (id, title, category, description, content_json, content_text, visible_roles, current_version, require_signature, sort_order)
values
  ('7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6001', 'Meal Period Waiver — Workdays of Six Hours or Less', 'hr', 'Voluntary waiver of the first meal period on workdays of no more than six hours. Signed and revoked by the employee in My Time.',
   '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Meal Period Waiver — Workdays of Six Hours or Less"}]},{"type":"paragraph","content":[{"type":"text","text":"California law requires an unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the fifth hour of work. When the total work period for the day is no more than six hours, the meal period may be waived by mutual consent of the employee and Green Dog."}]},{"type":"paragraph","content":[{"type":"text","text":"By signing, I voluntarily agree to waive my meal period on any workday on which my total work period is no more than six hours."}]},{"type":"paragraph","content":[{"type":"text","text":"I understand that:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may still take a meal period on any such day if I want to."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not apply to any workday on which I work more than six hours."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not affect my paid rest breaks."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Legal references: California Labor Code §512(a); IWC Wage Orders, section 11."}]}]}'::jsonb,
   'Meal Period Waiver — Workdays of Six Hours or Less

California law requires an unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the fifth hour of work. When the total work period for the day is no more than six hours, the meal period may be waived by mutual consent of the employee and Green Dog.

By signing, I voluntarily agree to waive my meal period on any workday on which my total work period is no more than six hours.

I understand that:

• Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it.

• I may still take a meal period on any such day if I want to.

• This waiver does not apply to any workday on which I work more than six hours.

• I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts.

• This waiver does not affect my paid rest breaks.

Legal references: California Labor Code §512(a); IWC Wage Orders, section 11.',
   '{}', 1, false, 900)
on conflict (id) do nothing;

insert into greendogops.resource_document_version
  (id, document_id, version_no, title, content_json, content_text, change_note, signature_required)
values
  ('7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6011', '7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6001', 1, 'Meal Period Waiver — Workdays of Six Hours or Less',
   '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Meal Period Waiver — Workdays of Six Hours or Less"}]},{"type":"paragraph","content":[{"type":"text","text":"California law requires an unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the fifth hour of work. When the total work period for the day is no more than six hours, the meal period may be waived by mutual consent of the employee and Green Dog."}]},{"type":"paragraph","content":[{"type":"text","text":"By signing, I voluntarily agree to waive my meal period on any workday on which my total work period is no more than six hours."}]},{"type":"paragraph","content":[{"type":"text","text":"I understand that:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may still take a meal period on any such day if I want to."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not apply to any workday on which I work more than six hours."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not affect my paid rest breaks."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Legal references: California Labor Code §512(a); IWC Wage Orders, section 11."}]}]}'::jsonb,
   'Meal Period Waiver — Workdays of Six Hours or Less

California law requires an unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the fifth hour of work. When the total work period for the day is no more than six hours, the meal period may be waived by mutual consent of the employee and Green Dog.

By signing, I voluntarily agree to waive my meal period on any workday on which my total work period is no more than six hours.

I understand that:

• Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it.

• I may still take a meal period on any such day if I want to.

• This waiver does not apply to any workday on which I work more than six hours.

• I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts.

• This waiver does not affect my paid rest breaks.

Legal references: California Labor Code §512(a); IWC Wage Orders, section 11.',
   'Draft for HR and payroll review. Meal waivers are offered in My Time only after an Admin turns on “Offer meal-period waivers in My Time” (Admin ▸ Settings).', false)
on conflict (id) do nothing;

insert into greendogops.resource_document
  (id, title, category, description, content_json, content_text, visible_roles, current_version, require_signature, sort_order)
values
  ('7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6002', 'Second Meal Period Waiver — Workdays of Twelve Hours or Less', 'hr', 'Voluntary waiver of the second meal period on workdays of no more than twelve hours, when the first meal period was taken. Signed and revoked by the employee in My Time.',
   '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Second Meal Period Waiver — Workdays of Twelve Hours or Less"}]},{"type":"paragraph","content":[{"type":"text","text":"California law requires a second unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the tenth hour of work. When the total work period for the day is no more than twelve hours, the second meal period may be waived by mutual consent of the employee and Green Dog, but only if the first meal period was not waived."}]},{"type":"paragraph","content":[{"type":"text","text":"By signing, I voluntarily agree to waive my second meal period on any workday on which my total work period is no more than twelve hours and I took my first meal period."}]},{"type":"paragraph","content":[{"type":"text","text":"I understand that:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may still take a second meal period on any such day if I want to."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not apply to any workday on which I work more than twelve hours, or on which I did not take my first meal period."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not affect my paid rest breaks."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Legal references: California Labor Code §512(a); IWC Wage Orders, section 11."}]}]}'::jsonb,
   'Second Meal Period Waiver — Workdays of Twelve Hours or Less

California law requires a second unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the tenth hour of work. When the total work period for the day is no more than twelve hours, the second meal period may be waived by mutual consent of the employee and Green Dog, but only if the first meal period was not waived.

By signing, I voluntarily agree to waive my second meal period on any workday on which my total work period is no more than twelve hours and I took my first meal period.

I understand that:

• Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it.

• I may still take a second meal period on any such day if I want to.

• This waiver does not apply to any workday on which I work more than twelve hours, or on which I did not take my first meal period.

• I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts.

• This waiver does not affect my paid rest breaks.

Legal references: California Labor Code §512(a); IWC Wage Orders, section 11.',
   '{}', 1, false, 900)
on conflict (id) do nothing;

insert into greendogops.resource_document_version
  (id, document_id, version_no, title, content_json, content_text, change_note, signature_required)
values
  ('7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6012', '7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6002', 1, 'Second Meal Period Waiver — Workdays of Twelve Hours or Less',
   '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Second Meal Period Waiver — Workdays of Twelve Hours or Less"}]},{"type":"paragraph","content":[{"type":"text","text":"California law requires a second unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the tenth hour of work. When the total work period for the day is no more than twelve hours, the second meal period may be waived by mutual consent of the employee and Green Dog, but only if the first meal period was not waived."}]},{"type":"paragraph","content":[{"type":"text","text":"By signing, I voluntarily agree to waive my second meal period on any workday on which my total work period is no more than twelve hours and I took my first meal period."}]},{"type":"paragraph","content":[{"type":"text","text":"I understand that:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may still take a second meal period on any such day if I want to."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not apply to any workday on which I work more than twelve hours, or on which I did not take my first meal period."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"This waiver does not affect my paid rest breaks."}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Legal references: California Labor Code §512(a); IWC Wage Orders, section 11."}]}]}'::jsonb,
   'Second Meal Period Waiver — Workdays of Twelve Hours or Less

California law requires a second unpaid, uninterrupted meal period of at least 30 minutes that starts before the end of the tenth hour of work. When the total work period for the day is no more than twelve hours, the second meal period may be waived by mutual consent of the employee and Green Dog, but only if the first meal period was not waived.

By signing, I voluntarily agree to waive my second meal period on any workday on which my total work period is no more than twelve hours and I took my first meal period.

I understand that:

• Signing this waiver is voluntary. It is not a condition of my employment, and I will not be treated differently if I do not sign it.

• I may still take a second meal period on any such day if I want to.

• This waiver does not apply to any workday on which I work more than twelve hours, or on which I did not take my first meal period.

• I may revoke this waiver at any time in My Time. Revoking takes effect immediately for later shifts.

• This waiver does not affect my paid rest breaks.

Legal references: California Labor Code §512(a); IWC Wage Orders, section 11.',
   'Draft for HR and payroll review. Meal waivers are offered in My Time only after an Admin turns on “Offer meal-period waivers in My Time” (Admin ▸ Settings).', false)
on conflict (id) do nothing;

-- 2. ------------------------------------------------------------------------
insert into greendogops.app_setting (key, value, category, label, description)
values (
  'timeclock.meal_waivers_live',
  'false'::jsonb,
  'timeclock',
  'Offer meal-period waivers in My Time',
  'Turn on after HR and payroll approve the waiver wording (Resources ▸ HR: the two “Meal Period Waiver” documents). Employees can then sign or revoke them in My Time.'
)
on conflict (key) do nothing;

-- 3. ------------------------------------------------------------------------
create table greendogops.meal_waiver (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references greendogops.person(id),
  kind          text not null check (kind in ('six_hour', 'second_meal')),
  document_id   uuid not null references greendogops.resource_document(id),
  version_id    uuid not null references greendogops.resource_document_version(id),
  version_no    integer not null check (version_no >= 1),
  signer_name   text not null check (length(btrim(signer_name)) between 2 and 200),
  signed_at     timestamptz not null default now(),
  app_user_id   uuid,
  ip            text,
  user_agent    text check (user_agent is null or length(user_agent) <= 400),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_note   text,
  constraint meal_waiver_revoked_after_signed check (revoked_at is null or revoked_at >= signed_at)
);

comment on table greendogops.meal_waiver is
  'Employee meal-period waivers (0242): signed in My Time against a specific resource_document_version, revocable (revoked_at), never deleted or edited otherwise. Service role only.';

create unique index meal_waiver_one_active
  on greendogops.meal_waiver (person_id, kind) where revoked_at is null;
create index meal_waiver_person_idx on greendogops.meal_waiver (person_id, kind, signed_at);

create or replace function greendogops.meal_waiver_guard() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
begin
  if tg_op = 'UPDATE' then
    if old.revoked_at is null
       and new.revoked_at is not null
       and (new.id, new.person_id, new.kind, new.document_id, new.version_id, new.version_no,
            new.signer_name, new.signed_at, new.app_user_id, new.ip, new.user_agent)
           is not distinct from
           (old.id, old.person_id, old.kind, old.document_id, old.version_id, old.version_no,
            old.signer_name, old.signed_at, old.app_user_id, old.ip, old.user_agent) then
      -- The database's clock decides when a revocation took effect.
      new.revoked_at := greatest(clock_timestamp(), old.signed_at);
      return new;
    end if;
    raise exception 'greendogops.meal_waiver: only revoking an active waiver is allowed'
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'greendogops.meal_waiver is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger meal_waiver_guard_row
  before update or delete on greendogops.meal_waiver
  for each row execute function greendogops.meal_waiver_guard();
create trigger meal_waiver_guard_truncate
  before truncate on greendogops.meal_waiver
  for each statement execute function greendogops.meal_waiver_guard();

alter table greendogops.meal_waiver enable row level security;
drop policy if exists gdo_members_all on greendogops.meal_waiver;
drop policy if exists service_role_only on greendogops.meal_waiver;
create policy service_role_only on greendogops.meal_waiver
  for all to authenticated using (false) with check (false);
revoke all on greendogops.meal_waiver from anon, authenticated;
revoke all on function greendogops.meal_waiver_guard() from public, anon, authenticated;

-- 4. ------------------------------------------------------------------------
create function greendogops.meal_waiver_in_force(p_person_id uuid, p_kind text, p_at timestamptz)
  returns boolean
  language sql stable
  set search_path to 'greendogops', 'pg_catalog'
as $$
  select exists (
    select 1 from greendogops.meal_waiver w
     where w.person_id = p_person_id
       and w.kind = p_kind
       and w.signed_at <= p_at
       and (w.revoked_at is null or w.revoked_at > p_at)
  );
$$;

comment on function greendogops.meal_waiver_in_force(uuid, text, timestamptz) is
  'True when the person had this kind of meal waiver in force at p_at (0242). Mirrors waiverInForce() in src/lib/timeclock/meal-waiver.ts. Service role only.';

revoke all on function greendogops.meal_waiver_in_force(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function greendogops.meal_waiver_in_force(uuid, text, timestamptz) to service_role;

commit;
