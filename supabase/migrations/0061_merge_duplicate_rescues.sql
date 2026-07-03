-- ============================================================================
-- Green Dog Ops — 0061 Merge duplicate rescue CRM records
-- ----------------------------------------------------------------------------
-- Collapses four duplicate rescue pairs into a single canonical record each and
-- removes one empty import artifact. No data is lost:
--   * The KEEPER record retains its (richer) field values; any field the keeper
--     is missing is filled from the duplicate (coalesce).
--   * The duplicate's notes (outreach history) are appended to the keeper with a
--     "[Merged from ...]" provenance marker; a differing website is preserved
--     inline as "Alt website".
--   * The only FKs to crm_organization (credential.org_id SET NULL,
--     crm_org_document.org_id CASCADE) are re-pointed to the keeper first
--     (currently zero rows reference the duplicates — done defensively).
--
-- Pairs (keeper  <-  duplicate):
--   Deity Animal Rescue            <- Deity Animal Rescue and Foundation
--   Pup Culture Dog Rescue         <- Pup Culture
--   GSI rescue                     <- GSL rescue
--   Buddy's Angel Rescue           <- Buddies & Angels
-- Artifact removed: "RESCUES PARTNERS GDDVC Rescue Partners" (all fields empty).
--
-- Idempotent: the duplicates are deleted at the end, so a re-run finds nothing
-- to merge or delete.
-- ============================================================================

do $$
declare
  pairs constant text[][] := array[
    array['7ac1fa40-0111-47b9-8930-60d126db7009','2c67bc03-9ef0-454b-a3c9-afaa01462b4d'], -- Deity
    array['20c32c8f-5766-409c-a2ee-7a8c0135423e','c32365a4-bbf7-49c8-b7f9-a4d8e637b492'], -- Pup Culture
    array['4d860ceb-fb3e-4424-811e-9dc9baa0fa47','65b16448-083e-472a-a2f6-fa951343fd95'], -- GSI/GSL
    array['db0d50bf-2163-45ee-8df0-5ed318bf833b','21767fb5-e308-4da7-a0e3-6fb92f34c843']  -- Buddies
  ];
  p text[];
  keeper uuid;
  dup uuid;
begin
  foreach p slice 1 in array pairs loop
    keeper := p[1]::uuid;
    dup    := p[2]::uuid;

    -- Re-point any linked children from the duplicate to the keeper.
    update greendogops.credential      set org_id = keeper where org_id = dup;
    update greendogops.crm_org_document set org_id = keeper where org_id = dup;

    -- Fold the duplicate's data into the keeper (keeper wins; gaps filled).
    update greendogops.crm_organization k
    set
      contact_name           = coalesce(nullif(k.contact_name, ''), d.contact_name),
      title                  = coalesce(k.title, d.title),
      phone                  = coalesce(nullif(k.phone, ''), d.phone),
      phone_alt              = coalesce(k.phone_alt, d.phone_alt),
      email                  = coalesce(nullif(k.email, ''), d.email),
      website                = coalesce(nullif(k.website, ''), d.website),
      instagram              = coalesce(nullif(k.instagram, ''), d.instagram),
      address                = coalesce(k.address, d.address),
      city                   = coalesce(k.city, d.city),
      state                  = coalesce(k.state, d.state),
      zip                    = coalesce(k.zip, d.zip),
      area                   = coalesce(nullif(k.area, ''), d.area),
      clinic_area            = coalesce(k.clinic_area, d.clinic_area),
      services               = coalesce(nullif(k.services, ''), d.services),
      tier                   = coalesce(k.tier, d.tier),
      priority               = coalesce(k.priority, d.priority),
      tax_id                 = coalesce(k.tax_id, d.tax_id),
      agreement_status       = coalesce(k.agreement_status, d.agreement_status),
      agreement_signed_date  = coalesce(k.agreement_signed_date, d.agreement_signed_date),
      secondary_contact_name  = coalesce(k.secondary_contact_name, d.secondary_contact_name),
      secondary_contact_email = coalesce(k.secondary_contact_email, d.secondary_contact_email),
      secondary_contact_phone = coalesce(k.secondary_contact_phone, d.secondary_contact_phone),
      is_preferred           = k.is_preferred or d.is_preferred,
      notes = nullif(
        trim(both E'\n' from
          coalesce(nullif(k.notes, '') || E'\n---\n', '')
          || '[Merged from "' || d.name || '"] '
          || coalesce(d.notes, '')
          || case
               when d.website is not null
                 and lower(coalesce(d.website, '')) <> lower(coalesce(k.website, ''))
               then ' | Alt website: ' || d.website
               else ''
             end
        ), '')
    from greendogops.crm_organization d
    where k.id = keeper and d.id = dup;

    -- Remove the now-merged duplicate.
    delete from greendogops.crm_organization where id = dup;
  end loop;

  -- GSI keeper's contact_name was an email; the merged Victoria Begler name is
  -- the real contact (the email is still preserved in the email column).
  update greendogops.crm_organization
  set contact_name = 'Victoria Begler'
  where id = '4d860ceb-fb3e-4424-811e-9dc9baa0fa47'
    and contact_name = 'toribegler@gmail.com';

  -- Empty import artifact (no contact/phone/email/notes — nothing to preserve).
  delete from greendogops.crm_organization
  where id = '2035745f-8cfd-4f5d-ba92-21360d0d9549'
    and coalesce(contact_name,'') = '' and coalesce(phone,'') = ''
    and coalesce(email,'') = '' and coalesce(notes,'') = '';
end $$;
