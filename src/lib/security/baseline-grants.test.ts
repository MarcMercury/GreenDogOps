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

  it("does not treat Employee (self-service) logins as GDO users", () => {
    const isGdoUser = functions().find((f) => f.name === "is_gdo_user");
    expect(isGdoUser?.body).toMatch(/role::text <> 'employee'/);
  });
});
