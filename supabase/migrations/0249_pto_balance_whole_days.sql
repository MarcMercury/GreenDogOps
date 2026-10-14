-- ============================================================================
-- Green Dog Ops — 0249 PTO balances are whole days
-- ----------------------------------------------------------------------------
-- Completes 0248. 0248 left person_employment.pto_used / pto_available
-- unconstrained because 29 former-employee profiles held CE budget and
-- benefits amounts (250, 500, 123.66, 1483.92) from a column-shifted roster
-- import. Those values were moved to the CE / benefits columns and the PTO set
-- to 6 / 0 / 6 (owner decision, 2026-10-14), so every balance is now whole.
-- ============================================================================

set search_path = greendogops, public;

begin;

alter table greendogops.person_employment
  add constraint person_employment_pto_used_whole
    check (pto_used is null or pto_used = trunc(pto_used)),
  add constraint person_employment_pto_available_whole
    check (pto_available is null or pto_available = trunc(pto_available));

commit;
