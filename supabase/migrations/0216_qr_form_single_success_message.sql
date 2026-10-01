-- ============================================================================
-- Green Dog Ops — 0216 One message on the capture form's confirmation screen
-- ----------------------------------------------------------------------------
-- WHY: 0215 added post_submit_message next to the existing success_message, so
-- the builder showed two boxes ("Thank-you message" and "Call to action") that
-- both rendered on the same confirmation screen. There is one screen, so there
-- is one message: success_message keeps the job and post_submit_message goes.
--
-- Safe to drop outright — 0215 shipped hours earlier and the column is still
-- NULL on every row. The COALESCE below is belt-and-braces for any environment
-- where someone filled it in before this ran.
-- ============================================================================
set search_path = greendogops, public;

update greendogops.qr_form
   set success_message = coalesce(nullif(trim(success_message), ''), post_submit_message)
 where post_submit_message is not null
   and coalesce(trim(success_message), '') = '';

alter table greendogops.qr_form
  drop column if exists post_submit_message;

comment on column greendogops.qr_form.success_message is
  'The single message on the confirmation screen, e.g. "Show this screen to spin the prize wheel!". Rendered large and in the form''s accent colour, never as HTML.';
