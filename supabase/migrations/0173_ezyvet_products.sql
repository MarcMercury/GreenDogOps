-- ============================================================================
-- Green Dog Ops — 0173 ezyVet Products (price/product catalog)
-- ----------------------------------------------------------------------------
-- Two ezyVet Report Center reports make up the product catalog:
--
--   * "Products"        — one row per product (~4k), every configuration flag:
--                         name, code, financial product group, product/clinical
--                         type, prescription + controlled-drug flags, supplier,
--                         inventory minimums, last invoiced date.
--   * "Product Pricing" — one row per product PER DIVISION (~7.9k): cost, sell
--                         price excl/incl tax and markup. Prices are set per
--                         hospital, so this cannot live on ezyvet_product.
--
-- Both are snapshots (no date range) scraped nightly by the ezyVet agent worker
-- exactly like Animals/Contacts, and upserted here. Feeds the Smart Report so
-- product/price questions can be answered ("what do we charge for a dental",
-- "which medications does Venice price differently", "cheapest supplier item").
-- ============================================================================
set search_path = greendogops, public;

create table if not exists greendogops.ezyvet_product (
  id                          uuid primary key default gen_random_uuid(),
  ezyvet_product_id           text not null unique,
  product_code                text,
  product_name                text,
  description                 text,
  product_group               text,

  -- Classification
  product_type                text,   -- Standard | Diagnostic | Medication | Procedure | Vaccination | Service Fee
  new_product_type            text,   -- Single Product | Package | Container | Bundle | Service Fee
  clinical_type               text,   -- None | Diagnostic | Medication | Procedure | Vaccination
  bundle_type                 text,   -- No | Package | Container | Bundle
  is_fixed_price_bundle       boolean,
  diagnostic_name             text,
  therapeutic_name            text,
  schedule_or_class           text,   -- controlled-drug schedule, when set

  -- Flags
  is_active                   boolean,
  is_sold                     boolean,
  is_purchased                boolean,
  excluded_from_sales         boolean,
  on_special                  boolean,
  available_on_web            boolean,
  requires_prescription       boolean,
  generates_prescription      boolean,
  is_rvm_medication           boolean,
  is_rabies_vax               boolean,
  can_expire                  boolean,
  is_container                boolean,
  is_template                 boolean,
  has_markup                  boolean,
  stock_goes_negative         boolean,
  requires_freight            boolean,
  tracking_level              text,   -- No | Product | Batch

  -- Commercial / inventory
  rrp                         numeric,
  barcode                     text,
  primary_barcode             text,
  external_reference          text,
  secondary_external_reference text,
  unique_identifier           text,
  supplier                    text,
  default_supplier            text,
  default_supplier_product_code text,
  supplier_contact            text,
  sales_account               text,
  purchases_account           text,
  inventory_account           text,
  minimum_inventory           numeric,
  minimum_reorder             numeric,
  minimum_sell_units          numeric,
  default_sell_units          numeric,
  lowest_dispensable_unit     text,
  lowest_dispensable_quantity numeric,
  concentration               numeric,
  concentration_unit          text,
  booster_duration_seconds    numeric,
  default_vaccination_qty     numeric,
  last_invoiced_date          date,

  -- Free text
  notes                       text,
  notes_important             boolean,
  warning                     text,
  instructions                text,
  default_medication_text     text,
  default_prescribing_user    text,

  -- ezyVet record audit
  ezyvet_created_at           timestamptz,
  ezyvet_created_by           text,
  ezyvet_modified_at          timestamptz,
  ezyvet_modified_by          text,

  first_seen_at               timestamptz not null default now(),
  last_import_id              uuid,
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_ezv_product_code   on greendogops.ezyvet_product (product_code);
create index if not exists idx_ezv_product_name   on greendogops.ezyvet_product (product_name);
create index if not exists idx_ezv_product_group  on greendogops.ezyvet_product (product_group);
create index if not exists idx_ezv_product_type   on greendogops.ezyvet_product (product_type);
create index if not exists idx_ezv_product_active on greendogops.ezyvet_product (is_active);

-- One row per product per hospital division.
create table if not exists greendogops.ezyvet_product_price (
  id                        uuid primary key default gen_random_uuid(),
  product_code              text not null,
  division                  text not null,
  product_name              text,
  product_group             text,
  cost                      numeric,
  sell_price_excl           numeric,
  sell_price_incl           numeric,
  markup                    numeric,
  service_fee_product_id    text,
  service_fee_product_code  text,
  service_fee_product_ref   text,
  first_seen_at             timestamptz not null default now(),
  last_import_id            uuid,
  updated_at                timestamptz not null default now(),
  unique (product_code, division)
);

create index if not exists idx_ezv_product_price_code on greendogops.ezyvet_product_price (product_code);
create index if not exists idx_ezv_product_price_div  on greendogops.ezyvet_product_price (division);

-- One row per ingest run (shared by both reports; `source` says which).
create table if not exists greendogops.ezyvet_product_import (
  id                 uuid primary key default gen_random_uuid(),
  filename           text,
  source             text not null default 'products',  -- products | pricing
  total_rows         integer not null default 0,
  new_rows           integer not null default 0,
  updated_rows       integer not null default 0,
  unchanged_rows     integer not null default 0,
  snapshot_date      date,
  details            jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ezv_product_import_created
  on greendogops.ezyvet_product_import (created_at desc);

grant select, insert, update, delete on
  greendogops.ezyvet_product,
  greendogops.ezyvet_product_price,
  greendogops.ezyvet_product_import
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Roll-ups (read by the Smart Report; service-role only, like every view here).
-- ---------------------------------------------------------------------------

-- The everyday answer surface: one row per product per division with its price.
create or replace view greendogops.report_product_price_list as
select
  p.ezyvet_product_id,
  p.product_code,
  coalesce(nullif(p.product_name, ''), pr.product_name) as product_name,
  coalesce(nullif(p.product_group, ''), pr.product_group) as product_group,
  p.product_type,
  p.clinical_type,
  p.is_active,
  p.is_sold,
  p.requires_prescription,
  p.supplier,
  pr.division,
  pr.cost,
  pr.sell_price_excl,
  pr.sell_price_incl,
  pr.markup,
  case
    when pr.cost > 0 and pr.sell_price_excl is not null
      then round(pr.sell_price_excl - pr.cost, 2)
  end as margin_dollars,
  p.last_invoiced_date
from greendogops.ezyvet_product_price pr
left join greendogops.ezyvet_product p on p.product_code = pr.product_code;

create or replace view greendogops.report_product_summary as
select
  count(*)::int                                          as total_products,
  count(*) filter (where is_active)::int                 as active_products,
  count(*) filter (where is_sold)::int                   as sellable_products,
  count(*) filter (where requires_prescription)::int     as prescription_products,
  count(distinct product_group)::int                     as product_groups,
  max(last_invoiced_date)                                as last_invoiced_date
from greendogops.ezyvet_product;

create or replace view greendogops.report_products_by_group as
select
  coalesce(nullif(p.product_group, ''), 'Unknown') as product_group,
  count(*)::int                                    as products,
  count(*) filter (where p.is_sold)::int           as sellable,
  round(avg(pr.sell_price_incl), 2)                as avg_price_incl
from greendogops.ezyvet_product p
left join greendogops.ezyvet_product_price pr on pr.product_code = p.product_code
group by 1
order by 2 desc;

grant select on
  greendogops.report_product_price_list,
  greendogops.report_product_summary,
  greendogops.report_products_by_group
to service_role;

-- ---------------------------------------------------------------------------
-- Register both reports in the daily ezyVet agent's catalog.
-- ---------------------------------------------------------------------------
insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'ezyvet_products', 'ezyVet Products', 'global',
       'Full product catalog (name, code, group, type, supplier, flags). Daily snapshot upserted into ezyvet_product.',
       'ezyvet_product', 17
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;

insert into greendogops.agent_report (agent_id, key, name, scope, description, target, sort_order)
select a.id, 'ezyvet_product_pricing', 'ezyVet Product Pricing', 'global',
       'Cost, sell price and markup for every product in every division. Daily snapshot upserted into ezyvet_product_price.',
       'ezyvet_product_price', 18
from greendogops.agent a
where a.key = 'ezyvet_daily_ingest'
on conflict (agent_id, key) do nothing;
