import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons?: { path: string }[] };
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"))
  .join("\n");

/** Endpoints registered as agents (`'endpoint', '/api/...'` in a migration). */
const registered = new Set([...migrations.matchAll(/'endpoint',\s*'(\/api\/[^'?]+)'/g)].map((m) => m[1]));

describe("scheduled job registry", () => {
  // An unregistered cron has no row in Admin ▸ Agents ▸ Health, so it can fail
  // silently — exactly what migration 0231 exists to prevent.
  it.each((vercel.crons ?? []).map((c) => c.path.split("?")[0]))("%s is registered as an agent", (path) => {
    expect(registered.has(path), `register ${path} in a migration (see 0231) and record runs with cron-run.ts`).toBe(
      true,
    );
  });
});
