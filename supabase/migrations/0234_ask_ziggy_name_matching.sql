--
-- 0234_ask_ziggy_name_matching.sql
--
-- 0233's lookups matched a client/patient name as a substring, so a short
-- surname ("Heo") also hit "Theodore", "Rheon", ... and tripped the 10-match
-- cap. Match in tiers instead: exact contact/animal code, then an exact
-- (case-insensitive) full name, last name or business name, and only when
-- nothing matches exactly, a substring. The cap still applies to every tier.

begin;

create or replace function greendogops.ziggy_client_codes(p_client text)
returns text[]
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
declare
  v text := btrim(coalesce(p_client, ''));
  v_lower text := lower(btrim(coalesce(p_client, '')));
  v_like text;
  v_codes text[];
begin
  if length(v) < 2 then
    raise exception 'Give a client name (at least 2 characters) or their ezyVet contact code.';
  end if;

  -- 1. An exact contact code wins.
  select array_agg(distinct s.code) into v_codes
    from (
      select c.contact_code as code from greendogops.ezyvet_contact c where c.contact_code = v
      union
      select l.client_contact_code from greendogops.ezyvet_invoice_line l where l.client_contact_code = v
    ) s;
  if v_codes is not null then
    return v_codes;
  end if;

  -- 2. Exact full name, last name or business name.
  select array_agg(m.code) into v_codes
    from (
      select distinct u.code
        from (
          select c.contact_code as code
            from greendogops.ezyvet_contact c
           where lower(btrim(c.full_name)) = v_lower
              or lower(btrim(concat_ws(' ', c.first_name, c.last_name))) = v_lower
              or lower(btrim(c.last_name)) = v_lower
              or lower(btrim(c.business_name)) = v_lower
          union
          select l.client_contact_code
            from greendogops.ezyvet_invoice_line l
           where lower(btrim(concat_ws(' ', l.first_name, l.last_name))) = v_lower
              or lower(btrim(l.last_name)) = v_lower
              or lower(btrim(l.business_name)) = v_lower
        ) u
       where coalesce(u.code, '') <> ''
       limit 11
    ) m;

  -- 3. Otherwise a name fragment, with LIKE wildcards in the input neutralised.
  if v_codes is null then
    v_like := '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select array_agg(m.code) into v_codes
      from (
        select distinct u.code
          from (
            select c.contact_code as code
              from greendogops.ezyvet_contact c
             where c.full_name ilike v_like
                or concat_ws(' ', c.first_name, c.last_name) ilike v_like
                or c.business_name ilike v_like
            union
            select l.client_contact_code
              from greendogops.ezyvet_invoice_line l
             where concat_ws(' ', l.first_name, l.last_name) ilike v_like
                or l.business_name ilike v_like
          ) u
         where coalesce(u.code, '') <> ''
         limit 11
      ) m;
  end if;

  if cardinality(v_codes) > 10 then
    raise exception 'More than 10 clients match "%". Use the ezyVet contact code or the client''s full name.', v;
  end if;
  return coalesce(v_codes, '{}'::text[]);
end;
$$;

create or replace function greendogops.ziggy_patient_codes(p_patient text)
returns text[]
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
declare
  v text := btrim(coalesce(p_patient, ''));
  v_like text;
  v_codes text[];
begin
  if length(v) < 2 then
    raise exception 'Give a patient name (at least 2 characters) or their ezyVet animal code.';
  end if;

  -- 1. Exact animal code.
  select array_agg(distinct s.code) into v_codes
    from (
      select a.animal_code as code from greendogops.ezyvet_animal a where a.animal_code = v
      union
      select l.animal_code from greendogops.ezyvet_invoice_line l where l.animal_code = v
    ) s;
  if v_codes is not null then
    return v_codes;
  end if;

  -- 2. Exact name, then 3. a name fragment.
  select array_agg(m.code) into v_codes
    from (
      select distinct a.animal_code as code
        from greendogops.ezyvet_animal a
       where lower(btrim(a.animal_name)) = lower(v)
         and coalesce(a.animal_code, '') <> ''
       limit 11
    ) m;

  if v_codes is null then
    v_like := '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select array_agg(m.code) into v_codes
      from (
        select distinct a.animal_code as code
          from greendogops.ezyvet_animal a
         where a.animal_name ilike v_like
           and coalesce(a.animal_code, '') <> ''
         limit 11
      ) m;
  end if;

  if cardinality(v_codes) > 10 then
    raise exception 'More than 10 patients match "%". Find the right one in ezyvet_animal (owner, species, breed) and pass its animal_code.', v;
  end if;
  return coalesce(v_codes, '{}'::text[]);
end;
$$;

revoke all on function greendogops.ziggy_client_codes(text) from public, anon, authenticated;
revoke all on function greendogops.ziggy_patient_codes(text) from public, anon, authenticated;
grant execute on function greendogops.ziggy_client_codes(text) to service_role;
grant execute on function greendogops.ziggy_patient_codes(text) to service_role;

commit;
