import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
  crons?: { path: string }[];
};

describe("isPublicPath", () => {
  // A cron path missing here is redirected to /login and silently never runs.
  it.each((vercel.crons ?? []).map((c) => c.path.split("?")[0]))(
    "lets the Vercel cron %s through the proxy",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it("keeps app pages and other admin APIs behind a session", () => {
    for (const path of ["/", "/hr", "/admin/slack", "/api/admin/slack", "/api/admin/slack/sync-all", "/api/admin/users"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});
