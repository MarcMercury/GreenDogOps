import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static check of the committed baseline (regenerate it after every migration).
// The live equivalent is greendogops.rls_audit(), which must return zero rows.
const baseline = readFileSync(join(process.cwd(), "supabase/baseline/0001_schema.sql"), "utf8");

// RLS policies call these with the API role, so it must be able to execute them.
const POLICY_HELPERS = new Set(["is_gdo_user", "is_gdo_admin"]);

interface FunctionDef {
  name: string;
  securityDefiner: boolean;
  returnsTrigger: boolean;
  body: string;
}

function functions(): FunctionDef[] {
  return [
    ...baseline.matchAll(
      /^CREATE FUNCTION greendogops\.(\w+)\([^)]*\) RETURNS ([\s\S]*?)\n    AS \$(\w*)\$([\s\S]*?)\$\3\$;/gm,
    ),
  ].map((m) => ({
    name: m[1],
    securityDefiner: /SECURITY DEFINER/.test(m[2]),
    returnsTrigger: /^(trigger|event_trigger)\b/.test(m[2]),
    body: m[4],
  }));
}

function grantedToAuthenticated(): Set<string> {
  return new Set(
    [...baseline.matchAll(/^GRANT ALL ON FUNCTION greendogops\.(\w+)\([^)]*\) TO authenticated;/gm)].map((m) => m[1]),
  );
}

describe("database grants (baseline)", () => {
  it("parses the baseline's functions", () => {
    const defs = functions();
    expect(defs.length).toBeGreaterThan(50);
    expect(defs.find((f) => f.name === "is_gdo_user")?.securityDefiner).toBe(true);
  });

  it("lets no API token call a SECURITY DEFINER function except the RLS policy helpers (0238)", () => {
    const granted = grantedToAuthenticated();
    const open = functions()
      .filter((f) => f.securityDefiner && !f.returnsTrigger && !POLICY_HELPERS.has(f.name) && granted.has(f.name))
      .map((f) => f.name);
    expect(open).toEqual([]);
  });

  it("keeps Staff read-only: every RLS table carries the three restrictive Staff policies (0239)", () => {
    const rlsTables = [...baseline.matchAll(/^ALTER TABLE greendogops\.(\w+) ENABLE ROW LEVEL SECURITY;/gm)].map((m) => m[1]);
    expect(rlsTables.length).toBeGreaterThan(100);
    const missing = rlsTables.filter((t) =>
      ["insert", "update", "delete"].some(
        (cmd) =>
          !new RegExp(`^CREATE POLICY staff_read_only_${cmd} ON greendogops\\.${t} AS RESTRICTIVE FOR ${cmd.toUpperCase()} `, "m").test(
            baseline,
          ),
      ),
    );
    expect(missing).toEqual([]);
  });

  it("rejects the retired employee role on app_user", () => {
    expect(baseline).toMatch(/CONSTRAINT app_user_role_supported CHECK/);
    const isGdoUser = functions().find((f) => f.name === "is_gdo_user");
    expect(isGdoUser?.body).not.toMatch(/employee/);
  });
});
