import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static check of the committed baseline (regenerate it after every migration).
// A policy that calls auth.uid() or is_gdo_user() bare re-runs it for every row;
// wrapped as (select …) Postgres runs it once per statement (0252, ~150x faster
// on sched_assignment). pg_dump prints the wrapped form as "( SELECT auth.uid() AS uid)".
const baseline = readFileSync(join(process.cwd(), "supabase/baseline/0001_schema.sql"), "utf8");

const BARE_CALL = /(?<!select )(auth\.uid\(\)|greendogops\.is_gdo_user\(\))/i;

function policies(): { name: string; table: string; sql: string }[] {
  return [...baseline.matchAll(/^CREATE POLICY (\w+) ON greendogops\.(\w+)[\s\S]*?;$/gm)].map((m) => ({
    name: m[1],
    table: m[2],
    sql: m[0],
  }));
}

function functionBody(name: string): string {
  const m = baseline.match(
    new RegExp(`^CREATE FUNCTION greendogops\\.${name}\\([^)]*\\)[\\s\\S]*?\\n    AS \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$;`, "m"),
  );
  return m?.[2] ?? "";
}

describe("RLS policies evaluate auth helpers once per statement (baseline)", () => {
  it("parses the baseline's policies", () => {
    expect(policies().length).toBeGreaterThan(700);
  });

  it("wraps every auth.uid() / is_gdo_user() call in a policy as (select …)", () => {
    const bare = policies()
      .filter((p) => BARE_CALL.test(p.sql))
      .map((p) => `${p.table}.${p.name}`);
    expect(bare).toEqual([]);
  });

  it("generates the wrapped form for tables created later", () => {
    for (const fn of ["protect_new_objects", "staff_read_only_policies"]) {
      const body = functionBody(fn);
      expect(body, fn).not.toBe("");
      expect(BARE_CALL.test(body), fn).toBe(false);
    }
    expect(functionBody("protect_new_objects")).toContain("(select greendogops.is_gdo_user())");
    expect(functionBody("staff_read_only_policies")).toContain("(select auth.uid())");
  });
});
