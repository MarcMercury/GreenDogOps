-- ============================================================================
-- 0125_marketing_resource_crm_link.sql
-- Link Marketing Resources (tool/login vault rows) to their Vendor & Partner
-- CRM record. One org can own many resources (e.g. two NextDayFlyers logins),
-- so the FK lives on marketing_resource. Both pages cross-reference via this
-- single column: the Resources tab shows the linked vendor, and the Vendor &
-- Partner org detail page lists the marketing resources that point back at it.
-- ============================================================================

alter table greendogops.marketing_resource
  add column if not exists crm_organization_id uuid
    references greendogops.crm_organization(id) on delete set null;

create index if not exists idx_marketing_resource_crm_org
  on greendogops.marketing_resource(crm_organization_id);

-- ----------------------------------------------------------------------------
-- Wire the reviewed cross-over matches. Matching is normalized (case /
-- whitespace / punctuation insensitive) so double-spaces and "of Commerce"
-- style suffixes on the org side are handled. Idempotent: only fills rows that
-- are not already linked, so re-running never clobbers manual edits.
-- ----------------------------------------------------------------------------
with mapping(resource_name, org_name) as (
  values
    ('AMAZON (Marketing Only)',                      'AMAZON'),
    ('AV Graphics',                                  'AV Graphics'),
    ('Beverly Hills Chamber  (MY PET MOBILE VET)',   'Beverly Hills Chamber (MY PET MOBILE VET)'),
    ('Builtmore ProPrint',                           'Builtmore ProPrint'),
    ('Copy Hub',                                     'Copy Hub'),
    ('Digital Image Solutions',                      'Digital Image Solutions'),
    ('Dog PPL Calendar',                             'Dog PPL Calendar'),
    ('Embroidery Station',                           'Embroidery Station'),
    ('Epic Print Solutions',                         'Epic Print Solutions'),
    ('Eventbrite',                                   'Eventbrite (local)'),
    ('Ezyvet - Veterinary Software',                 'EzyVet'),
    ('FedEx Office Print & Ship Center',             'FedEx Office Print & Ship Center'),
    ('Main Street SM Events',                        'Main Street SM Events'),
    ('NextDayFlyers',                                'NextDayFlyers'),
    ('NextDayFlyers ( Gladys'' account for marketing )', 'NextDayFlyers'),
    ('PrintPlace',                                   'PrintPlace'),
    ('Review Tree',                                  'Review Tree'),
    ('Santa Monica Chamber',                         'Santa Monica Chamber of Commerce'),
    ('Sherman Oaks Chamber',                         'Sherman Oaks Chamber of commerce'),
    ('SM Chamber Calendar',                          'SM Chamber Calendar'),
    ('SO Chamber Calendar',                          'SO Chamber Calendar'),
    ('Staples',                                      'Staples'),
    ('ThumbPrint',                                   'ThumbPrint'),
    ('Uniform Scrubs',                               'Uniform Scrubs'),
    ('UPrinting',                                    'UPrinting'),
    ('USPS',                                         'USPS'),
    ('Venice Chamber',                               'Venice Chamber of Commerce'),
    ('Venice Chamber Calendar',                      'Venice Chamber Calendar'),
    ('Venice Heritage Museum',                       'Venice Heritage Museum'),
    ('Venice Papparazzi Main Page',                  'Venice Papparazzi'),
    ('Yelp Business',                                'Yelp')
)
update greendogops.marketing_resource mr
set crm_organization_id = o.id
from mapping m
join greendogops.crm_organization o
  on regexp_replace(lower(o.name), '[^a-z0-9]+', '', 'g')
   = regexp_replace(lower(m.org_name), '[^a-z0-9]+', '', 'g')
 and o.org_type in ('marketing_partner', 'facility_resource', 'med_ops', 'office_marketing')
 and (o.subtype is null or o.subtype <> 'rescue')
where regexp_replace(lower(mr.name), '[^a-z0-9]+', '', 'g')
    = regexp_replace(lower(m.resource_name), '[^a-z0-9]+', '', 'g')
  and mr.crm_organization_id is null;
