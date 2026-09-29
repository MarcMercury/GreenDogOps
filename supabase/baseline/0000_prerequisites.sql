-- ============================================================================
-- Green Dog Ops — baseline prerequisites
-- ----------------------------------------------------------------------------
-- Types that live in `public` but that greendogops tables depend on.
--
-- greendogops.marketing_influencers was originally created with
-- `LIKE public.marketing_influencers` (migration 0009), which copies a column's
-- TYPE but not the type's definition. The column therefore still refers to
-- public.influencer_status, an enum owned by the EmployeeGMGDD application that
-- exists only in the production project. A fresh project must define it before
-- the schema will load.
--
-- This is intentionally the narrowest possible stand-in: one enum. The rest of
-- the greendogops schema has no cross-schema dependency.
-- ============================================================================
do $$
begin
  create type public.influencer_status as enum
    ('active', 'prospect', 'inactive', 'completed');
exception
  when duplicate_object then null;
end $$;
