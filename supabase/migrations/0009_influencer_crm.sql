-- =====================================================
-- Migration 0009: Influencer CRM (Marketing Influencers)
-- =====================================================
-- Ports the EmployeeGMGDD "Influencer Management" feature into the
-- greendogops schema as a self-contained module.
--
-- Mirrors the source public.marketing_influencers table (structure + data)
-- into greendogops so Green Dog Ops owns its own copy of every influencer
-- contact (85 partners/prospects, with social, audience, compensation and
-- performance fields).
--
-- LIKE ... copies column types, defaults, NOT NULL + CHECK constraints and
-- indexes, but NOT foreign keys (intentional — the source FKs point at
-- auth.users / profiles which we don't mirror).
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Mirror table structure
-- ---------------------------------------------------------------
create table if not exists greendogops.marketing_influencers
  (like public.marketing_influencers including defaults including constraints including indexes);

-- ---------------------------------------------------------------
-- 2. Copy data (idempotent: skip rows already present by id)
-- ---------------------------------------------------------------
insert into greendogops.marketing_influencers
  select * from public.marketing_influencers s
  where not exists (
    select 1 from greendogops.marketing_influencers g where g.id = s.id
  );

-- ---------------------------------------------------------------
-- 3. Grants (greendogops uses app-layer gating, RLS disabled — same as
--    crm_organization etc. in 0003)
-- ---------------------------------------------------------------
grant select, insert, update, delete on greendogops.marketing_influencers to authenticated, service_role;

-- ---------------------------------------------------------------
-- 4. Keep updated_at fresh on edits
-- ---------------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.marketing_influencers;
create trigger set_updated_at before update on greendogops.marketing_influencers
  for each row execute function greendogops.set_updated_at();
