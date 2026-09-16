-- Student CRM "Rec Level" is a fixed Blank / Red / Yellow / Green choice, but
-- the Google Sheet sync and legacy imports stored mixed casing ("GREEN" vs
-- "green"), which split the grid filter into duplicate options. Collapse the
-- column to lowercase and keep it that way with a trigger + check constraint.

update greendogops.crm_contact
   set doc_recommendation = lower(trim(doc_recommendation))
 where doc_recommendation is not null
   and doc_recommendation <> lower(trim(doc_recommendation));

-- Anything that isn't one of the three levels is not a recommendation.
update greendogops.crm_contact
   set doc_recommendation = null
 where doc_recommendation is not null
   and doc_recommendation not in ('red', 'yellow', 'green');

create or replace function greendogops.normalize_doc_recommendation()
returns trigger
language plpgsql
as $$
begin
  new.doc_recommendation := nullif(lower(trim(coalesce(new.doc_recommendation, ''))), '');
  if new.doc_recommendation is not null
     and new.doc_recommendation not in ('red', 'yellow', 'green') then
    new.doc_recommendation := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_doc_recommendation on greendogops.crm_contact;
create trigger trg_normalize_doc_recommendation
  before insert or update of doc_recommendation on greendogops.crm_contact
  for each row execute function greendogops.normalize_doc_recommendation();
