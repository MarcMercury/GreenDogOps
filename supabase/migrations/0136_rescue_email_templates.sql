-- ============================================================================
-- Green Dog Ops — 0136 Rescue email templates (seed)
-- ----------------------------------------------------------------------------
-- Starter templates for the Rescues & Shelters "Send Email" action. Category
-- 'rescue' so they only appear on the rescue page (and in the Admin Templates
-- "Rescues & Shelters" group). Seeded only if no rescue templates exist yet.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.email_template (name, description, category, subject, body)
select * from (values
  (
    'Thank you (rescue partner)',
    'Thank a rescue/shelter partner for their collaboration.',
    'rescue',
    'Thank you from Green Dog Dental, {{contact_first_name}}',
    E'Hi {{contact_first_name}},\n\nThank you for partnering with Green Dog Dental to care for the animals at {{account_name}}. We are grateful for the work you do and proud to support your adoptions.\n\nIf there is anything we can help with — dental cases, wellness, or an upcoming event — just reply to this email.\n\nWarm regards,\n{{sender_name}}\nGreen Dog Dental'
  ),
  (
    'Adoption event / clinic invite',
    'Invite a rescue to a Green Dog adoption event or dental clinic.',
    'rescue',
    'Let''s partner on an event, {{contact_first_name}}',
    E'Hi {{contact_first_name}},\n\nWe would love to collaborate with {{account_name}} on an upcoming adoption event or dental clinic for your animals. These are a great way to support your adoptable pets and your community.\n\nReply here and I will share available dates and details.\n\nBest,\n{{sender_name}}\nGreen Dog Dental'
  ),
  (
    'Rescue check-in / reconnect',
    'Light check-in for rescue partners we have not connected with recently.',
    'rescue',
    'Checking in with {{account_name}}',
    E'Hi {{contact_first_name}},\n\nIt has been a little while since we connected — our last contact was {{last_contact_date}}. I wanted to check in and see how things are going at {{account_name}} and whether your animals have any dental or medical needs we can help with.\n\nWould you be open to a quick call or visit?\n\nThanks,\n{{sender_name}}\nGreen Dog Dental'
  )
) as seed(name, description, category, subject, body)
where not exists (
  select 1 from greendogops.email_template where category = 'rescue'
);
