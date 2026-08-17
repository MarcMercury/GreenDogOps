-- 0162_normalize_phone_numbers.sql
-- App-wide phone formatting. Mirrors src/lib/shared/phone.ts:
--   * US / Canada (NANP) numbers render as (###) ###-####, the +1 is dropped.
--   * Numbers resolving to a country outside the NANP keep an explicit
--     "+<code>" prefix.
--   * Anything unrecognizable is returned untouched rather than mangled.
-- The function is kept for future bulk loads; the DO block below back-fills
-- every existing phone-bearing text column in the schema.

create or replace function greendogops.format_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  -- ITU-T E.164 country calling codes, excluding 1 (US / Canada / NANP).
  calling_codes constant text[] := array[
    '7','20','27','30','31','32','33','34','36','39','40','41','43','44','45',
    '46','47','48','49','51','52','53','54','55','56','57','58','60','61','62',
    '63','64','65','66','81','82','84','86','90','91','92','93','94','95','98',
    '211','212','213','216','218','220','221','222','223','224','225','226',
    '227','228','229','230','231','232','233','234','235','236','237','238',
    '239','240','241','242','243','244','245','246','247','248','249','250',
    '251','252','253','254','255','256','257','258','260','261','262','263',
    '264','265','266','267','268','269','290','291','297','298','299',
    '350','351','352','353','354','355','356','357','358','359','370','371',
    '372','373','374','375','376','377','378','379','380','381','382','383',
    '385','386','387','389','420','421','423',
    '500','501','502','503','504','505','506','507','508','509','590','591',
    '592','593','594','595','596','597','598','599',
    '670','672','673','674','675','676','677','678','679','680','681','682',
    '683','685','686','687','688','689','690','691','692',
    '850','852','853','855','856','880','886',
    '960','961','962','963','964','965','966','967','968','970','971','972',
    '973','974','975','976','977','992','993','994','995','996','998'
  ];
  trimmed  text;
  cleaned  text;
  digits   text;
  intl     boolean := false;
  cc       text := null;
  national text;
  grouped  text;
  pos      int;
  head     int;
begin
  if raw is null then return null; end if;
  trimmed := btrim(raw);
  if trimmed = '' then return null; end if;

  cleaned := regexp_replace(trimmed, '[^0-9+]', '', 'g');
  if cleaned = '' then return trimmed; end if;

  digits := regexp_replace(cleaned, '[^0-9]', '', 'g');
  intl := left(cleaned, 1) = '+';

  -- "011" / "00" are international dialing prefixes; same meaning as a "+".
  if not intl and digits ~ '^(011|00)[0-9]' then
    digits := regexp_replace(digits, '^(011|00)', '');
    intl := true;
  end if;

  if length(digits) = 11 and left(digits, 1) = '1' then
    digits := right(digits, 10);
  end if;

  if length(digits) = 10 then
    return '(' || substr(digits, 1, 3) || ') '
               || substr(digits, 4, 3) || '-'
               || substr(digits, 7, 4);
  end if;

  if intl or length(digits) > 11 then
    for pos in reverse 3 .. 1 loop
      if left(digits, pos) = any (calling_codes) then
        cc := left(digits, pos);
        exit;
      end if;
    end loop;

    if cc is not null then
      national := substr(digits, length(cc) + 1);
      if length(national) >= 4 then
        -- Right-aligned 3-digit blocks; a lone leading digit joins the next.
        head := length(national) % 3;
        if head = 0 then
          head := 3;
        elsif head = 1 then
          head := 4;
        end if;
        grouped := substr(national, 1, head);
        pos := head + 1;
        while pos <= length(national) loop
          grouped := grouped || ' ' || substr(national, pos, 3);
          pos := pos + 3;
        end loop;
        return '+' || cc || ' ' || grouped;
      end if;
    end if;
  end if;

  return trimmed;
end;
$$;

-- Back-fill every existing phone-bearing text column in the schema.
do $$
declare
  col record;
begin
  for col in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'greendogops'
      and c.data_type in ('text', 'character varying')
      and c.column_name ~ '(^|_)(phone|mobile|fax)(_|$)'
      -- Exclude descriptor columns (e.g. contact-method / system-type fields).
      and c.column_name !~ '(type|kind|system|method|provider|carrier|status|note|url|label)'
  loop
    execute format(
      'update greendogops.%I set %I = greendogops.format_phone(%I)
         where %I is not null
           and %I is distinct from greendogops.format_phone(%I)',
      col.table_name, col.column_name, col.column_name,
      col.column_name, col.column_name, col.column_name
    );
  end loop;
end;
$$;
