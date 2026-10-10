import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROLES } from "../auth/permissions";
import { ALWAYS_BLOCKED_TABLES, blockedIdentifier, smartScopeFor } from "./smart-scope";

const baseline = readFileSync(join(process.cwd(), "supabase/baseline/0001_schema.sql"), "utf8");

/**
 * Service-role-only tables that are legitimate reporting data. Anything else
 * the API role cannot read must be on ALWAYS_BLOCKED_TABLES, because
 * smart_query() runs as the service role and would return it.
 */
const SERVICE_ONLY_REPORTABLE: Record<string, string> = {
  ezyvet_tag: "ezyVet tag catalog (AP / alert / coded-client tags)",
  ezyvet_record_tag: "which ezyVet records carry those tags",
  ezyvet_record_tag_run: "tag export run history",
  person_employment: "gated per role by HR_RECORD_TABLES and COMPENSATION_COLUMNS",
  smart_glossary: "Smart Report's own business definitions",
};

function serviceOnlyTables(): string[] {
  const all = new Set([...baseline.matchAll(/^CREATE TABLE greendogops\.([a-z_0-9]+)/gm)].map((m) => m[1]));
  const apiReadable = new Set(
    [...baseline.matchAll(/^GRANT [A-Z,]*SELECT[A-Z,]* ON TABLE greendogops\.([a-z_0-9]+) TO authenticated/gm)].map(
      (m) => m[1],
    ),
  );
  const denyAll = new Set(
    [...baseline.matchAll(/^CREATE POLICY \w+ ON greendogops\.([a-z_0-9]+) TO authenticated USING \(false\)/gm)].map(
      (m) => m[1],
    ),
  );
  return [...all].filter((t) => !apiReadable.has(t) || denyAll.has(t)).sort();
}

describe("smartScopeFor", () => {
  it("never lets any role query private, security or messaging tables", () => {
    for (const role of APP_ROLES) {
      const blocked = smartScopeFor(role).blockedTables;
      for (const t of [
        "ops_task",
        "user_notification",
        "notification_delivery",
        "reminder_rule",
        "reminder_ack",
        "credential",
        "recruiter_google_token",
        "sms_message",
        "sms_consent",
        "sms_opt_out",
        "person_slack_link",
        "audit_log",
        "smart_question_log",
      ]) {
        expect(blocked, `${role} / ${t}`).toContain(t);
      }
    }
  });

  it("blocks every service-role-only table in the baseline unless it is listed as reportable", () => {
    const tables = serviceOnlyTables();
    expect(tables.length).toBeGreaterThan(10);
    const blocked = new Set<string>(ALWAYS_BLOCKED_TABLES);
    const missing = tables.filter((t) => !blocked.has(t) && !(t in SERVICE_ONLY_REPORTABLE));
    expect(missing, "add these to ALWAYS_BLOCKED_TABLES (or SERVICE_ONLY_REPORTABLE with a reason)").toEqual([]);
  });

  it("keeps compensation for Owner/Admin/Executive only", () => {
    expect(smartScopeFor("owner").canViewCompensation).toBe(true);
    expect(smartScopeFor("executive").canViewCompensation).toBe(true);
    expect(smartScopeFor("manager").canViewCompensation).toBe(false);
    expect(smartScopeFor("schedule_admin").blockedTables).toContain("person_license");
  });
});

describe("blockedIdentifier", () => {
  const owner = smartScopeFor("owner");

  it("rejects other schemas for every role, however they are written", () => {
    for (const sql of [
      "select * from public.employees",
      'select * from "public"."employees"',
      "select * from PUBLIC . employees",
      "select id from auth.users",
      "select * from vault.decrypted_secrets",
      "select name from storage.objects",
      "select table_name from information_schema.tables",
      "select * from pg_catalog.pg_roles",
      "select count(*) from person p join public.profiles x on x.id = p.id",
    ]) {
      expect(blockedIdentifier(sql, owner), sql).toMatch(/schema$/);
    }
  });

  it("rejects blocked tables for the owner too", () => {
    expect(blockedIdentifier("select body from sms_message", owner)).toBe("sms_message");
    expect(blockedIdentifier("select * from recruiter_google_token", owner)).toBe("recruiter_google_token");
  });

  it("allows ordinary greendogops queries, aliases and schema names inside strings or comments", () => {
    for (const sql of [
      "select p.first_name, net.total from person p join ezyvet_invoice_line net on net.person_id = p.id",
      "select * from greendogops.person",
      "select 'public.x' as label from person",
      "select id from person -- not public.employees",
      "select publication_date from person_document_public_view",
    ]) {
      expect(blockedIdentifier(sql, owner), sql).toBeNull();
    }
  });
});
