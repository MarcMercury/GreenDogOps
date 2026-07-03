-- ============================================================================
-- Green Dog Ops — 0062 Merge duplicate Vendor & Partner records (whole CRM)
-- ----------------------------------------------------------------------------
-- Reviews the entire Vendor & Partner directory (org_type in marketing_partner,
-- facility_resource, med_ops, office_marketing) and collapses every exact
-- name-match duplicate group into one canonical record. Common causes: the same
-- vendor logged in two sections (e.g. Costco in both marketing & office), and
-- re-imports that created near-identical rows.
--
-- No data is lost:
--   * KEEPER per group = active first, then a specific (non-"other") subtype,
--     then the richest record, then the oldest. It retains its own values; any
--     field it is missing is filled from each duplicate (coalesce).
--   * Each duplicate's notes are appended to the keeper with a
--     "[Merged from \"name\"]" marker. A differing website / email / phone /
--     contact that coalesce cannot capture is preserved inline as "Alt ...".
--   * The only FKs to crm_organization (credential.org_id SET NULL,
--     crm_org_document.org_id CASCADE) are re-pointed to the keeper first.
--
-- Idempotent: duplicates are deleted, so a re-run finds nothing to merge.
-- ============================================================================

do $$
declare
  vp_types constant text[] := array[
    'marketing_partner','facility_resource','med_ops','office_marketing'];
  grp record;
  keeper_id uuid;
  dup record;
begin
  -- --------------------------------------------------------------------------
  -- Targeted pre-merge: "Bark N' Bitches" exists in three spellings that do NOT
  -- share a normalized name (the signed rescue record carries a " Dog Rescue"
  -- suffix). Fold the two non-rescue rows into the canonical rescue record so
  -- the generic pass below sees a single Bark record.
  -- --------------------------------------------------------------------------
  for dup in
    select * from greendogops.crm_organization
    where id in ('443ab584-fa99-4699-84c7-b05bd2cc3f6b',
                 '8bcdbb67-a6cf-4589-a500-a808090bbce7')
  loop
    keeper_id := 'dbd25f6b-a8f7-4fcb-ab11-78b7662e3cc4'; -- Bark N' Bitches Dog Rescue
    update greendogops.credential      set org_id = keeper_id where org_id = dup.id;
    update greendogops.crm_org_document set org_id = keeper_id where org_id = dup.id;
    update greendogops.crm_organization k set
      contact_name = coalesce(nullif(k.contact_name,''), dup.contact_name),
      phone        = coalesce(nullif(k.phone,''), dup.phone),
      email        = coalesce(nullif(k.email,''), dup.email),
      website      = coalesce(nullif(k.website,''), dup.website),
      external_id  = coalesce(k.external_id, dup.external_id),
      notes = nullif(trim(both E'\n' from
        coalesce(nullif(k.notes,'') || E'\n---\n','')
        || '[Merged from "' || dup.name || '"]'
        || case when dup.email is not null and lower(coalesce(dup.email,'')) <> lower(coalesce(k.email,''))
                then ' | Alt email: ' || dup.email else '' end),'')
    where k.id = keeper_id;
    delete from greendogops.crm_organization where id = dup.id;
  end loop;

  -- --------------------------------------------------------------------------
  -- Generic pass: every remaining exact name-match group.
  -- --------------------------------------------------------------------------
  for grp in
    select regexp_replace(lower(name),'[^a-z0-9]','','g') as norm
    from greendogops.crm_organization
    where org_type = any(vp_types)
    group by 1
    having count(*) > 1
  loop
    -- Choose the keeper for this group.
    select id into keeper_id
    from greendogops.crm_organization
    where org_type = any(vp_types)
      and regexp_replace(lower(name),'[^a-z0-9]','','g') = grp.norm
    order by
      (status = 'active') desc nulls last,
      (subtype is not null and lower(subtype) not in ('other','')) desc,
      ( (contact_name is not null)::int + (phone is not null)::int
      + (email is not null)::int + (website is not null)::int
      + (instagram is not null)::int + (address is not null)::int
      + (city is not null)::int + (notes is not null)::int
      + (services is not null)::int + (account_number is not null)::int
      + (account_rep is not null)::int + (tax_id is not null)::int
      + (area is not null)::int + (tier is not null)::int
      + (priority is not null)::int + (membership_level is not null)::int
      + (agreement_status is not null)::int + (secondary_contact_name is not null)::int
      + (monthly_spend is not null)::int + (spend_ytd is not null)::int ) desc,
      created_at asc nulls last,
      id
    limit 1;

    -- Fold every other record in the group into the keeper.
    for dup in
      select * from greendogops.crm_organization
      where org_type = any(vp_types)
        and regexp_replace(lower(name),'[^a-z0-9]','','g') = grp.norm
        and id <> keeper_id
    loop
      update greendogops.credential      set org_id = keeper_id where org_id = dup.id;
      update greendogops.crm_org_document set org_id = keeper_id where org_id = dup.id;

      update greendogops.crm_organization k set
        contact_name           = coalesce(nullif(k.contact_name,''), dup.contact_name),
        title                  = coalesce(nullif(k.title,''), dup.title),
        phone                  = coalesce(nullif(k.phone,''), dup.phone),
        phone_alt              = coalesce(nullif(k.phone_alt,''), dup.phone_alt),
        email                  = coalesce(nullif(k.email,''), dup.email),
        website                = coalesce(nullif(k.website,''), dup.website),
        instagram              = coalesce(nullif(k.instagram,''), dup.instagram),
        address                = coalesce(nullif(k.address,''), dup.address),
        city                   = coalesce(nullif(k.city,''), dup.city),
        state                  = coalesce(nullif(k.state,''), dup.state),
        zip                    = coalesce(nullif(k.zip,''), dup.zip),
        area                   = coalesce(nullif(k.area,''), dup.area),
        clinic_area            = coalesce(k.clinic_area, dup.clinic_area),
        subtype                = coalesce(nullif(k.subtype,''), nullif(dup.subtype,'')),
        category               = coalesce(nullif(k.category,''), dup.category),
        services               = coalesce(nullif(k.services,''), dup.services),
        products               = coalesce(k.products, dup.products),
        tier                   = coalesce(k.tier, dup.tier),
        priority               = coalesce(k.priority, dup.priority),
        membership_level       = coalesce(k.membership_level, dup.membership_level),
        annual_fee             = coalesce(k.annual_fee, dup.annual_fee),
        account_number         = coalesce(nullif(k.account_number,''), dup.account_number),
        account_rep            = coalesce(nullif(k.account_rep,''), dup.account_rep),
        total_referrals        = coalesce(k.total_referrals, dup.total_referrals),
        revenue                = coalesce(k.revenue, dup.revenue),
        monthly_spend          = coalesce(k.monthly_spend, dup.monthly_spend),
        spend_ytd              = coalesce(k.spend_ytd, dup.spend_ytd),
        relationship_score     = coalesce(k.relationship_score, dup.relationship_score),
        internal_rating        = coalesce(k.internal_rating, dup.internal_rating),
        tax_id                 = coalesce(nullif(k.tax_id,''), dup.tax_id),
        agreement_status       = coalesce(k.agreement_status, dup.agreement_status),
        agreement_signed_date  = coalesce(k.agreement_signed_date, dup.agreement_signed_date),
        secondary_contact_name  = coalesce(nullif(k.secondary_contact_name,''), dup.secondary_contact_name),
        secondary_contact_title = coalesce(nullif(k.secondary_contact_title,''), dup.secondary_contact_title),
        secondary_contact_email = coalesce(nullif(k.secondary_contact_email,''), dup.secondary_contact_email),
        secondary_contact_phone = coalesce(nullif(k.secondary_contact_phone,''), dup.secondary_contact_phone),
        last_visit_date        = coalesce(k.last_visit_date, dup.last_visit_date),
        last_contact_date      = coalesce(k.last_contact_date, dup.last_contact_date),
        last_referral_date     = coalesce(k.last_referral_date, dup.last_referral_date),
        is_preferred           = k.is_preferred or dup.is_preferred,
        is_active              = k.is_active or dup.is_active,
        external_id            = coalesce(k.external_id, dup.external_id),
        notes = nullif(trim(both E'\n' from
          coalesce(nullif(k.notes,'') || E'\n---\n','')
          || case when lower(k.name) <> lower(dup.name)
                  then '[Merged from "' || dup.name || '"] '
                  else '[Merged duplicate] ' end
          || coalesce(dup.notes,'')
          || case when dup.website is not null
                    and lower(coalesce(dup.website,'')) <> lower(coalesce(k.website,''))
                  then ' | Alt website: ' || dup.website else '' end
          || case when dup.email is not null
                    and lower(coalesce(dup.email,'')) <> lower(coalesce(k.email,''))
                  then ' | Alt email: ' || dup.email else '' end
          || case when dup.phone is not null
                    and coalesce(dup.phone,'') <> coalesce(k.phone,'')
                    and coalesce(dup.phone,'') <> coalesce(k.phone_alt,'')
                  then ' | Alt phone: ' || dup.phone else '' end
          || case when dup.contact_name is not null
                    and lower(coalesce(dup.contact_name,'')) <> lower(coalesce(k.contact_name,''))
                  then ' | Alt contact: ' || dup.contact_name else '' end
        ),'')
      where k.id = keeper_id;

      delete from greendogops.crm_organization where id = dup.id;
    end loop;
  end loop;
end $$;
