-- ============================================================================
-- Green Dog Ops — baseline global objects
-- ----------------------------------------------------------------------------
-- Event triggers are cluster-wide, not schema-scoped, so `pg_dump --schema`
-- never emits them and 0001_schema.sql cannot contain this.
--
-- Leaving it out is a security hole rather than a cosmetic gap: 0001_init_schema
-- grants the `authenticated` role full DML on new tables by default, and this
-- trigger is what immediately enables RLS on anything created afterwards. A
-- database rebuilt without it would silently expose every new table.
-- ============================================================================
drop event trigger if exists greendogops_protect_new_objects;

create event trigger greendogops_protect_new_objects on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'CREATE VIEW',
               'CREATE MATERIALIZED VIEW', 'CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function greendogops.protect_new_objects();
