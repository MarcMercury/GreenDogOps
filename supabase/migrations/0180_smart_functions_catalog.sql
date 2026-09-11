-- ============================================================================
-- Green Dog Ops — 0180 Smart Report: expose queryable functions
-- ----------------------------------------------------------------------------
-- smart_schema() lists tables, views and matviews, so the only set-returning
-- FUNCTION the model knew about was appointment_review(), because DOMAIN_NOTES
-- happens to name it. appointment_review_by_type, cancelled_appointments_*,
-- medical_board_coverage and the bizdev_* demand helpers were invisible.
--
-- smart_functions() lists the read-only, set-returning functions worth calling
-- from a SELECT, with their argument list and result columns. Mutating helpers
-- (recalculate_partner_metrics, undo_referral_upload) and the Smart Report's own
-- plumbing are excluded — the model must never be told to call those.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.smart_functions()
returns jsonb
language sql
stable
security definer
set search_path to 'greendogops', 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(f order by f->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'name',    p.proname,
             'args',    pg_get_function_identity_arguments(p.oid),
             'returns', pg_get_function_result(p.oid),
             'comment', obj_description(p.oid, 'pg_proc')
           ) as f
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'greendogops'
      and p.prokind = 'f'
      and p.proretset
      and p.provolatile in ('i', 's')          -- immutable/stable = cannot write
      and p.proname not in (
        'smart_query', 'smart_schema', 'smart_value_hints', 'smart_functions',
        'recalculate_partner_metrics', 'undo_referral_upload', 'rls_audit'
      )
  ) s;
$function$;

revoke all on function greendogops.smart_functions() from public, anon, authenticated;
grant execute on function greendogops.smart_functions() to service_role;

comment on function greendogops.smart_functions() is
  'Read-only set-returning functions the Smart Report may call from a SELECT.';

-- Descriptions the model reads. Without these it only sees the signature.
comment on function greendogops.appointment_review(date, date) is
  'Booked vs rendered appointments per location/department/day. Returns location_name, department_name, appt_date, expected_count (booked) and rendered_count. THE canonical source for "how many appointments are booked on <day>" — it already picks the right agenda snapshot.';
comment on function greendogops.appointment_review_by_type(date, date) is
  'The same booked vs rendered comparison grouped by ezyVet appointment TYPE per location: scheduled, rendered, added, not_rendered, pending.';
comment on function greendogops.cancelled_appointments_by_type(date, date) is
  'Cancelled appointments per location and appointment type over a date range. The source of truth for cancellations — the agenda excludes cancelled appointments, so booked-vs-rendered only infers them.';
comment on function greendogops.medical_board_coverage(date) is
  'Medical board coverage for one day: which board slots are staffed and by whom.';
comment on function greendogops.bizdev_hour_demand() is
  'Realized booked appointments by hour of day per location (avg_per_open_day) — when appointments actually book.';
comment on function greendogops.bizdev_weekday_factor() is
  'How busy each weekday runs per location versus a typical weekday (1.0 = normal), from 18 months of revenue.';
comment on function greendogops.bizdev_appt_type_daily_avg() is
  'Realized average appointments per open day per (location, appointment type).';
comment on function greendogops.bizdev_appt_type_value() is
  'Average realized revenue per appointment per (location, appointment type), recovered by matching the agenda to invoices.';
comment on function greendogops.appt_type_observed_counts() is
  'How often each ezyVet appointment type appears in the booked-appointment snapshots (popularity).';
