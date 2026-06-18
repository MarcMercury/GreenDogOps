-- ============================================================================
-- Green Dog Ops — 0017 Locations directory
-- ----------------------------------------------------------------------------
-- Make `greendogops.location` the single, rich source of truth for clinic
-- locations across the whole program (admin Settings, scheduling, HR, ...).
--
--   * adds full address / contact / map metadata to each location;
--   * adds `kind` (clinic | mobile) and a `parent_location_id` so a mobile
--     hospital can reference the physical site it is parked at;
--   * upserts the four canonical Green Dog locations with real-world data
--     scraped from https://www.greendogdental.com/locations;
--   * soft-deactivates any stray locations (e.g. legacy "Aetna" / "San Marino")
--     so historical schedule assignments keep their foreign keys;
--   * keeps the legacy `app_setting` key `org.locations` as a derived mirror
--     of the active location names.
-- ============================================================================
set search_path = greendogops, public;

-- Rich metadata -------------------------------------------------------------
alter table greendogops.location add column if not exists kind          text not null default 'clinic';
alter table greendogops.location add column if not exists display_name  text;
alter table greendogops.location add column if not exists address_line1 text;
alter table greendogops.location add column if not exists address_line2 text;
alter table greendogops.location add column if not exists city          text;
alter table greendogops.location add column if not exists state         text;
alter table greendogops.location add column if not exists postal_code   text;
alter table greendogops.location add column if not exists phone         text;
alter table greendogops.location add column if not exists email         text;
alter table greendogops.location add column if not exists map_url       text;
alter table greendogops.location add column if not exists website_url   text;
alter table greendogops.location add column if not exists notes         text;
alter table greendogops.location
  add column if not exists parent_location_id uuid references greendogops.location (id) on delete set null;

do $$ begin
  alter table greendogops.location
    add constraint location_kind_chk check (kind in ('clinic', 'mobile'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Upsert the four canonical locations (match case-insensitively by name).
-- ---------------------------------------------------------------------------
do $$
declare
  v_valley uuid;
begin
  -- 1) Sherman Oaks -------------------------------------------------------
  if exists (select 1 from greendogops.location where lower(name) = 'sherman oaks') then
    update greendogops.location set
      short_code='SO', color='#10b981', sort_order=10, is_active=true,
      kind='clinic', display_name='Sherman Oaks',
      address_line1='13907 Ventura Blvd', address_line2='Unit 101',
      city='Sherman Oaks', state='CA', postal_code='91423',
      phone='(310) 606-2407', email='info@greendogdental.com',
      map_url='https://maps.google.com/?q=13907+Ventura+Blvd+Unit+101,+Sherman+Oaks,+CA+91423',
      website_url='https://www.greendogdental.com/locations/sherman-oaks',
      updated_at=now()
    where lower(name) = 'sherman oaks';
  else
    insert into greendogops.location
      (name, code, short_code, color, sort_order, is_active, kind, display_name,
       address_line1, address_line2, city, state, postal_code, phone, email, map_url, website_url)
    values
      ('Sherman Oaks','SO','SO','#10b981',10,true,'clinic','Sherman Oaks',
       '13907 Ventura Blvd','Unit 101','Sherman Oaks','CA','91423','(310) 606-2407','info@greendogdental.com',
       'https://maps.google.com/?q=13907+Ventura+Blvd+Unit+101,+Sherman+Oaks,+CA+91423',
       'https://www.greendogdental.com/locations/sherman-oaks');
  end if;

  -- 2) Venice -------------------------------------------------------------
  if exists (select 1 from greendogops.location where lower(name) = 'venice') then
    update greendogops.location set
      short_code='VEN', color='#0ea5e9', sort_order=20, is_active=true,
      kind='clinic', display_name='Venice',
      address_line1='210 Main St', address_line2=null,
      city='Venice', state='CA', postal_code='90291',
      phone='(310) 606-2407', email='info@greendogdental.com',
      map_url='https://maps.google.com/?q=210+Main+St,+Venice,+CA+90291',
      website_url='https://www.greendogdental.com/locations/venice',
      updated_at=now()
    where lower(name) = 'venice';
  else
    insert into greendogops.location
      (name, code, short_code, color, sort_order, is_active, kind, display_name,
       address_line1, city, state, postal_code, phone, email, map_url, website_url)
    values
      ('Venice','VEN','VEN','#0ea5e9',20,true,'clinic','Venice',
       '210 Main St','Venice','CA','90291','(310) 606-2407','info@greendogdental.com',
       'https://maps.google.com/?q=210+Main+St,+Venice,+CA+90291',
       'https://www.greendogdental.com/locations/venice');
  end if;

  -- 3) Van Nuys / The Valley ---------------------------------------------
  if exists (select 1 from greendogops.location where lower(name) = 'van nuys') then
    update greendogops.location set
      short_code='VAN', color='#8b5cf6', sort_order=30, is_active=true,
      kind='clinic', display_name='The Valley',
      address_line1='14661 Aetna St', address_line2=null,
      city='Van Nuys', state='CA', postal_code='91411',
      phone='(310) 606-2407', email='info@greendogdental.com',
      map_url='https://maps.google.com/?q=14661+Aetna+St,+Van+Nuys,+CA+91411',
      website_url='https://www.greendogdental.com/valley',
      updated_at=now()
    where lower(name) = 'van nuys';
  else
    insert into greendogops.location
      (name, code, short_code, color, sort_order, is_active, kind, display_name,
       address_line1, city, state, postal_code, phone, email, map_url, website_url)
    values
      ('Van Nuys','VAN','VAN','#8b5cf6',30,true,'clinic','The Valley',
       '14661 Aetna St','Van Nuys','CA','91411','(310) 606-2407','info@greendogdental.com',
       'https://maps.google.com/?q=14661+Aetna+St,+Van+Nuys,+CA+91411',
       'https://www.greendogdental.com/valley');
  end if;

  select id into v_valley
    from greendogops.location where lower(name) = 'van nuys' limit 1;

  -- 4) MPMV — mobile hospital parked at The Valley (Van Nuys) -------------
  if exists (select 1 from greendogops.location where lower(name) = 'mpmv') then
    update greendogops.location set
      short_code='MPMV', color='#f59e0b', sort_order=40, is_active=true,
      kind='mobile', display_name='MPMV (Mobile Hospital)',
      parent_location_id=v_valley,
      address_line1='14661 Aetna St', address_line2=null,
      city='Van Nuys', state='CA', postal_code='91411',
      phone='(310) 606-2407', email='info@greendogdental.com',
      map_url='https://maps.google.com/?q=14661+Aetna+St,+Van+Nuys,+CA+91411',
      website_url='https://www.greendogdental.com/valley',
      notes='Mobile hospital — parked at The Valley (Van Nuys) location.',
      updated_at=now()
    where lower(name) = 'mpmv';
  else
    insert into greendogops.location
      (name, code, short_code, color, sort_order, is_active, kind, display_name, parent_location_id,
       address_line1, city, state, postal_code, phone, email, map_url, website_url, notes)
    values
      ('MPMV','MPMV','MPMV','#f59e0b',40,true,'mobile','MPMV (Mobile Hospital)',v_valley,
       '14661 Aetna St','Van Nuys','CA','91411','(310) 606-2407','info@greendogdental.com',
       'https://maps.google.com/?q=14661+Aetna+St,+Van+Nuys,+CA+91411',
       'https://www.greendogdental.com/valley',
       'Mobile hospital — parked at The Valley (Van Nuys) location.');
  end if;

  -- Soft-deactivate any location that is not one of the canonical four.
  update greendogops.location set is_active = false, updated_at = now()
   where is_active
     and lower(name) not in ('sherman oaks', 'venice', 'van nuys', 'mpmv');
end $$;

-- ---------------------------------------------------------------------------
-- Keep the legacy flat setting in sync (derived mirror of active locations).
-- ---------------------------------------------------------------------------
update greendogops.app_setting
   set value = to_jsonb(array(
         select name
           from greendogops.location
          where is_active
          order by sort_order, name)),
       updated_at = now()
 where key = 'org.locations';
