-- ============================================================================
-- Green Dog Ops — 0069 Normalize recruiting `source` values
-- ----------------------------------------------------------------------------
-- The person_recruiting.source column has accumulated many near-duplicate
-- values that differ only by spelling, capitalization, abbreviation, or minor
-- wording. Collapse each cluster onto a single canonical spelling so the
-- Recruiting/ATS "Source" filter and dropdown stay clean. Distinct real
-- sources (e.g. "OLD MVS grid", the dated referral-bonus tags) are left alone.
-- ============================================================================

set search_path = greendogops, public;

-- Indeed
update person_recruiting set source = 'Indeed'
where source in ('indeed');

-- ZipRecruiter
update person_recruiting set source = 'ZipRecruiter'
where source in ('ZipR', 'zipR', 'zipr', 'Ziprecruiter', 'ZR');

-- Career Builder (typo)
update person_recruiting set source = 'Career Builder'
where source in ('Cereer Builder');

-- Facebook
update person_recruiting set source = 'Facebook'
where source in ('FB');

-- Social Media
update person_recruiting set source = 'Social Media'
where source in ('social media');

-- GD Website (in-house site / inbound web inquiries)
update person_recruiting set source = 'GD Website'
where source in ('GD', 'Website Inquiry');

-- Personal Referral (generic "ref" shorthand)
update person_recruiting set source = 'Personal Referral'
where source in ('ref', 'Ref', 'REF');

-- Doctor referral
update person_recruiting set source = 'Doc'
where source in ('Doc?');

-- Nick — college outreach variants
update person_recruiting set source = 'Nick college post'
where source in ('Nick college posts', 'Nick recruit from college email');

-- Nick — social media variants
update person_recruiting set source = 'Nick social media'
where source in ('Nick''s social media post');

-- Veterinary America
update person_recruiting set source = 'Veterinary America'
where source in ('Vet America site');
