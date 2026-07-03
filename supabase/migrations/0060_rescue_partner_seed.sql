-- ============================================================================
-- Green Dog Ops — 0060 Rescue Partner CRM seed / reconcile
-- ----------------------------------------------------------------------------
-- Source: public/"GDDVC Rescue Partners  - ALL RESCUE VETTING.pdf" +
--         "GDDVC - Rescue Partners Protocols & Guidelines.pdf".
-- Adds the vetted rescue partners and reconciles records already in the CRM.
-- All rescues live in crm_organization (org_type='marketing_partner',
-- subtype='rescue', category='marketing').
--
-- Idempotent: existing records are matched on a punctuation-insensitive name
-- (norm = lower, alphanumerics only) and UPDATED in place; missing records are
-- INSERTED only when no matching rescue exists. Existing contact details are
-- preserved (coalesce) so a re-run never wipes richer data. Safe to re-apply.
-- ============================================================================

do $$
begin
  create temporary table _rescue_seed (
    name                    text,
    contact_name            text,
    phone                   text,
    email                   text,
    website                 text,
    secondary_contact_name  text,
    secondary_contact_email text,
    status                  text,
    agreement_status        text,
    is_preferred            boolean,
    notes                   text
  ) on commit drop;

  insert into _rescue_seed
    (name, contact_name, phone, email, website, secondary_contact_name, secondary_contact_email, status, agreement_status, is_preferred, notes) values
    -- Signed partners --------------------------------------------------------
    ('De Leon Foundation','Yari De Leon','814-737-2222','Deleonfoundation22@gmail.com','https://www.deleonanimalrescue.org/',null,null,'active','signed',true,'Signed rescue partner. Uses a SEPARATE De Leon agreement ($25 exam deposit per pet; RESCUE TEMP sales template + RESCUEBUN billing trigger). Scheduling limited to Venice and Van Nuys.'),
    ('Mutternity Project','Asia Bornetto','(213) 864-5196','asia@mutternityproject.org',null,'Kris Gunn','kris@vcla.agency','active','signed',true,'Signed rescue partner. Two exec contacts: Asia Bornetto (primary), Kris Gunn (secondary).'),
    ('Frankie Lola and Friends','Lisa Chiarelli','(818) 388-6982','frankielolaandfriends@gmail.com','https://frankielolaandfriends.com/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Cavalier Rescue','Donna Beirne','818-929-0777','cavalier.rescue.usa@mac.com','https://www.cavalierrescueusa.org/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Bark N'' Bitches Dog Rescue','Shannon Von Roemer','(818) 300-3889','adopt@barknbitches.com','https://www.barknbitches.com/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Marley''s Mutts','Connor Long','(661) 303-9808','clong@marleymutts.org','https://marleysmutts.org/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Hope for China Dogs Rescue','Margo Rogat','(303) 667-7622','info@hopeforchinadogsrescue.org','https://www.hopeforchinadogsrescue.org/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Samson''s Sanctuary','Rickie Tice','(516) 355-8153','samsonssanctuary@gmail.com','https://www.samsonssanctuary.org/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Big Love Animal Rescue','Lisa Arturo','310-403-2202','contact@bigloveanimalrescue.org','https://bigloveanimalrescue.org/',null,null,'active','signed',true,'Signed rescue partner.'),
    ('Project Minnie','Amanda Skerski','310-654-1908','askerski@yahoo.com',null,null,null,'active','signed',true,'Signed rescue partner.'),
    ('Balanced Dog Rescue','Torina Yamada','424-443-9750','balanceddogrescue@gmail.com',null,null,null,'active','signed',true,'Signed rescue partner.'),
    ('Ace of Hearts Dog Rescue','Brian NG','310-415-2021','aceofheartsmngr@gmail.com',null,null,null,'active','signed',true,'Signed rescue partner.'),
    ('Weird Rescue','Bree Xandrick','562-587-5707','Hello@Weirdrescue.com',null,null,null,'active','signed',true,'Signed rescue partner.'),
    ('Kitty of Angels Rescue','Lizzie Lewis','310-291-0426','lizzie@kittyofangels.org',null,'Brian Lewis',null,'active','signed',true,'Signed rescue partner (cat rescue).'),
    ('Mad Love Animal Rescue','Nikki Terranova','213-364-2353','madlovear@gmail.com',null,null,null,'active','signed',true,'Signed rescue partner.'),
    -- Special-terms partner --------------------------------------------------
    ('Vanderpump Dogs','Paola Pierantoni','310-489-5556','paola@vanderpumpdogs.org','https://www.vanderpumpdogs.org/',null,null,'active','pending',true,'Active rescue partner with SPECIAL discounts (exams/NADs 50% off; labs & imaging 25% off; advanced procedures ~$800-900). Agreement approved, not yet sent. IG: @vanderpumpdogs.'),
    -- Agreement out for signature -------------------------------------------
    ('Hounds and Heroes','Lisa Pellegrene','(310) 801-7627','lisa@houndsandheroes.com','https://houndsandheroes.com/',null,null,'active','sent','false','Agreement sent via DocuSign; signature pending.'),
    -- Approved, agreement not yet sent --------------------------------------
    ('Deity Animal Rescue','Ellen Dante','310-926-7945','deityanimalrescue@gmail.com','https://www.deityanimalrescue.org/',null,null,'active','pending',false,'Approved rescue partner; agreement not yet sent.'),
    ('Korean K9 Rescue','Gina Boehler','347-466-0333','Gina.boehler@koreank9rescue.org','https://www.koreank9rescue.org/',null,null,'active','pending',false,'Approved rescue partner; agreement not yet sent.'),
    -- Exotics rescues — offered coupon discounts, not partnered -------------
    ('Reptile and Amphibian Rescue','Sabine Bradley','(323) 301-3360','info@rarn.org','https://rarn.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('LA Rabbit Foundation',null,null,'larabbits@gmail.com','https://www.larabbits.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('So Cal Guinea Pig Rescue',null,null,null,'https://www.socalguineapigrescue.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('So Cal Turtle Rescue',null,null,null,'https://socalturtlerescue.com/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('OC Cavy Haven',null,'(714) 242-7548','cavyhaven.info@gmail.com','https://occavyhaven.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('Bunny Bunch',null,'(833) 372-2248','info.bunnybunch@gmail.com','https://www.bunnybunch.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.'),
    ('Bunny Luv',null,'(818) 988-4488','bunnyluv@bunnyluv.org','https://www.bunnyluv.org/',null,null,'prospect','none',false,'Exotics rescue — offered coupon discount; not partnered.');

  -- Update existing rescue records in place (preserve richer existing data) --
  update greendogops.crm_organization o
  set
    subtype          = 'rescue',
    category         = coalesce(o.category, 'marketing'),
    status           = s.status,
    agreement_status = s.agreement_status,
    is_preferred     = s.is_preferred,
    contact_name           = coalesce(o.contact_name, s.contact_name),
    phone                  = coalesce(nullif(o.phone, ''), s.phone),
    email                  = coalesce(nullif(o.email, ''), s.email),
    website                = coalesce(nullif(o.website, ''), s.website),
    secondary_contact_name  = coalesce(o.secondary_contact_name, s.secondary_contact_name),
    secondary_contact_email = coalesce(o.secondary_contact_email, s.secondary_contact_email),
    notes            = coalesce(nullif(o.notes, ''), s.notes)
  from _rescue_seed s
  where o.subtype = 'rescue'
    and regexp_replace(lower(o.name), '[^a-z0-9]', '', 'g')
      = regexp_replace(lower(s.name), '[^a-z0-9]', '', 'g');

  -- Insert rescues that are not yet in the CRM ------------------------------
  insert into greendogops.crm_organization
    (org_type, name, subtype, category, status, agreement_status, is_preferred,
     contact_name, phone, email, website,
     secondary_contact_name, secondary_contact_email, notes, source, is_active)
  select
    'marketing_partner', s.name, 'rescue', 'marketing', s.status, s.agreement_status,
    s.is_preferred, s.contact_name, s.phone, s.email, s.website,
    s.secondary_contact_name, s.secondary_contact_email, s.notes,
    'rescue_vetting_2025', true
  from _rescue_seed s
  where not exists (
    select 1 from greendogops.crm_organization o
    where o.subtype = 'rescue'
      and regexp_replace(lower(o.name), '[^a-z0-9]', '', 'g')
        = regexp_replace(lower(s.name), '[^a-z0-9]', '', 'g')
  );
end $$;
