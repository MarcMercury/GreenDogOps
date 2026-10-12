import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROLES, type AppRole, type AppUser } from "../auth/permissions";
import {
  ALWAYS_BLOCKED_TABLES,
  GENERAL_ALLOWED_TABLES,
  blockedIdentifier,
  scopeForUser,
  smartScopeFor,
  withCatalog,
} from "./smart-scope";

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

function appUser(role: AppRole, moduleAccess: Record<string, boolean> = {}): AppUser {
  return {
    id: "u",
    email: "u@example.com",
    full_name: null,
    title: null,
    role,
    is_active: true,
    module_access: moduleAccess,
    notes: null,
    person_id: null,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

/** Body of a CREATE TABLE / VIEW / FUNCTION statement in the baseline, or null. */
function baselineObject(name: string): string | null {
  const patterns = [
    new RegExp(`^CREATE TABLE greendogops\\.${name} \\(([\\s\\S]*?)^\\);`, "m"),
    new RegExp(`^CREATE (?:MATERIALIZED )?VIEW greendogops\\.${name} AS([\\s\\S]*?);$`, "m"),
    new RegExp(`^CREATE FUNCTION greendogops\\.${name}\\(([^\\n]*)`, "m"),
  ];
  for (const re of patterns) {
    const m = baseline.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Anything that reads like money. Every General-tier object must be free of it. */
const MONEY = /\b\w*(revenue|total_incl|total_excl|price|amount|spend|cost|balance|wage|salary|payment|pay_min|pay_max|receivable|collections?)\w*\b/i;

describe("General tier (Staff)", () => {
  const general = smartScopeFor("staff");

  it("is the scope for plain Staff and excludes financials, compensation and HR files", () => {
    expect(general.tier).toBe("general");
    expect(general.canViewFinancials).toBe(false);
    expect(general.canViewCompensation).toBe(false);
    expect(general.canViewHrRecords).toBe(false);
    expect(general.allowedTables).toBe(GENERAL_ALLOWED_TABLES);
    for (const role of APP_ROLES.filter((r) => r !== "staff")) {
      expect(smartScopeFor(role).canViewFinancials, role).toBe(true);
      expect(smartScopeFor(role).allowedTables, role).toBeNull();
    }
  });

  it("gives Staff granted the Reporting module the same scope as other non-HR roles", () => {
    expect(scopeForUser(appUser("staff")).tier).toBe("general");
    expect(scopeForUser(appUser("staff", { reporting: true })).tier).toBe("basic");
    expect(scopeForUser(appUser("owner")).tier).toBe("full");
    expect(scopeForUser(appUser("manager")).tier).toBe("hr");
  });

  it("only allows objects that exist in the baseline and carry no money", () => {
    // Positive control: the detector must catch the objects we know hold money.
    for (const name of ["ezyvet_invoice_line", "ezyvet_contact", "ezyvet_appointment", "report_location_period"]) {
      expect(baselineObject(name), name).toMatch(MONEY);
    }
    for (const name of GENERAL_ALLOWED_TABLES) {
      const body = baselineObject(name);
      expect(body, `${name} is not in the baseline`).not.toBeNull();
      expect(body?.match(MONEY)?.[0] ?? null, `${name} exposes money`).toBeNull();
    }
  });

  it("never allows a table every role is blocked from, or the HR file", () => {
    for (const name of GENERAL_ALLOWED_TABLES) {
      expect(ALWAYS_BLOCKED_TABLES as readonly string[]).not.toContain(name);
      expect(smartScopeFor("schedule_admin").blockedTables).not.toContain(name);
    }
    for (const name of ["person", "person_employment", "person_time_off", "ezyvet_contact", "ezyvet_invoice_line"]) {
      expect(GENERAL_ALLOWED_TABLES as readonly string[]).not.toContain(name);
    }
  });

  it("blocks everything in the live catalog that is not allowed", () => {
    const resolved = withCatalog(general, [
      "ezyvet_animal",
      "ezyvet_invoice_line",
      "ezyvet_contact",
      "person",
      "report_location_period",
      "smart_examples",
      "Some_New_Table",
    ]);
    expect(resolved.blockedTables).toEqual(
      expect.arrayContaining([
        "ezyvet_invoice_line",
        "ezyvet_contact",
        "person",
        "report_location_period",
        "smart_examples",
        "some_new_table",
      ]),
    );
    expect(resolved.blockedTables).not.toContain("ezyvet_animal");
    expect(blockedIdentifier("select sum(total_incl) from ezyvet_invoice_line", resolved)).toBe("ezyvet_invoice_line");
    expect(blockedIdentifier("select * from report_location_period(current_date, current_date)", resolved)).toBe(
      "report_location_period",
    );
    expect(
      blockedIdentifier(
        "select animal_name, owner_full_name, next_vaccination_due from ezyvet_animal where animal_name ilike 'bella%'",
        resolved,
      ),
    ).toBeNull();
  });

  it("leaves scopes without an allow-list unchanged", () => {
    const owner = smartScopeFor("owner");
    expect(withCatalog(owner, ["ezyvet_invoice_line", "person"])).toBe(owner);
  });
});

describe("functions that read data the identifier check cannot see", () => {
  it("are rejected for every role, Owner included", () => {
    for (const role of APP_ROLES) {
      const scope = smartScopeFor(role);
      for (const sql of [
        "select query_to_xml('select * from person_employment', true, false, '')",
        "select query_to_xml_and_xmlschema('select 1', true, false, '')",
        "select table_to_xml('person_employment'::regclass, true, false, '')",
        "select table_to_xml(12345, true, false, '')",
        "select * from ts_stat('select to_tsvector(annual_wages::text) from person_employment')",
        "select ts_rewrite('a'::tsquery, 'select 1')",
        "select to_regclass('person_employment')",
        "select query from pg_stat_activity",
        "select lo_get(1234)",
      ]) {
        expect(blockedIdentifier(sql, scope), `${role}: ${sql}`).not.toBeNull();
      }
    }
  });

  it("do not trip on ordinary column names", () => {
    const owner = smartScopeFor("owner");
    expect(blockedIdentifier("select location_key, logged_at from ezyvet_invoice_line", owner)).toBeNull();
  });
});
