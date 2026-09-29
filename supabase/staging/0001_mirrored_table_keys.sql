-- ============================================================================
-- Staging bootstrap — run AFTER supabase/migrations/*.
-- ----------------------------------------------------------------------------
-- `LIKE ... INCLUDING INDEXES` does not carry primary keys across from the
-- shim tables, which later migrations need in order to attach foreign keys.
-- ============================================================================

alter table greendogops.clinic_visits add constraint clinic_visits_pkey PRIMARY KEY (id);
alter table greendogops.marketing_influencers add constraint marketing_influencers_pkey PRIMARY KEY (id);
alter table greendogops.partner_contacts add constraint partner_contacts_pkey PRIMARY KEY (id);
alter table greendogops.partner_notes add constraint partner_notes_pkey PRIMARY KEY (id);
alter table greendogops.referral_partners add constraint referral_partners_pkey PRIMARY KEY (id);
alter table greendogops.referral_revenue_line_items add constraint referral_revenue_line_items_pkey PRIMARY KEY (id);
alter table greendogops.referral_sync_history add constraint referral_sync_history_pkey PRIMARY KEY (id);
