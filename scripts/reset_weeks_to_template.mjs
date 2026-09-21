#!/usr/bin/env node
/**
 * Rebuild the shift lines of a week (and every week after it) from the current
 * Dept/Shift Template, so the grid shows exactly the lines Setup defines.
 *
 *   node scripts/reset_weeks_to_template.mjs 2026-09-20           # dry run
 *   node scripts/reset_weeks_to_template.mjs 2026-09-20 --apply
 *
 * Weeks accumulate lines: each one is snapshotted from the template the day it
 * is created, then edited, then ad-hoc lines get added on top. The result is
 * duplicate-looking shifts that no longer match Setup. This drops the week's
 * lines and re-snapshots them.
 *
 * Assignments hang off line_id, so they go with the lines. Every deleted
 * assignment is written to .data/ first, and the sheet sync puts the schedule
 * names straight back. Published weeks are never touched.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "./lib/google-auth.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const APPLY = process.argv.includes("--apply");
const from = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!from) {
  console.error("usage: reset_weeks_to_template.mjs <YYYY-MM-DD week_start> [--apply]");
  process.exit(2);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "greendogops" },
});

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
};

const templates = must(
  await supabase
    .from("sched_shift_template")
    .select("id, department_id, role_id, label, start_time, end_time, sort_order")
    .eq("is_active", true)
    .order("sort_order"),
  "templates",
);
if (!templates.length) throw new Error("the Dept/Shift Template is empty — refusing to wipe weeks");

const weeks = must(
  await supabase
    .from("sched_week")
    .select("id, week_start, status, is_template")
    .gte("week_start", from)
    .order("week_start"),
  "weeks",
).filter((w) => !w.is_template);

const depts = new Map(
  must(await supabase.from("sched_department").select("id, name"), "depts").map((d) => [d.id, d.name]),
);
const roles = new Map(
  must(await supabase.from("sched_role").select("id, name"), "roles").map((r) => [r.id, r.name]),
);

const backup = [];
let dropped = 0;
let created = 0;

for (const week of weeks) {
  if (week.status === "published") {
    console.log(`${week.week_start}  published — skipped`);
    continue;
  }

  const lines = must(
    await supabase.from("sched_week_line").select("id").eq("week_id", week.id),
    "lines",
  );
  const asg = must(
    await supabase
      .from("sched_assignment")
      .select("*")
      .eq("week_id", week.id),
    "assignments",
  );
  backup.push(...asg);

  const fromSheet = asg.filter((a) => a.source === "sheet").length;
  console.log(
    `${week.week_start}  ${lines.length} lines -> ${templates.length};` +
      ` ${asg.length} assignments dropped (${fromSheet} of them re-imported from the sheet)`,
  );

  if (!APPLY) continue;

  // Assignments reference line_id, so they have to go first.
  if (asg.length) {
    const del = await supabase.from("sched_assignment").delete().eq("week_id", week.id);
    if (del.error) throw new Error(`clear assignments ${week.week_start}: ${del.error.message}`);
  }
  if (lines.length) {
    const del = await supabase.from("sched_week_line").delete().eq("week_id", week.id);
    if (del.error) throw new Error(`clear lines ${week.week_start}: ${del.error.message}`);
  }
  dropped += asg.length;

  const ins = await supabase.from("sched_week_line").insert(
    templates.map((t, i) => ({
      week_id: week.id,
      template_id: t.id,
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: t.sort_order ?? i,
      is_adhoc: false,
    })),
  );
  if (ins.error) throw new Error(`insert lines ${week.week_start}: ${ins.error.message}`);
  created += templates.length;
}

if (backup.length) {
  fs.mkdirSync(path.join(ROOT, ".data"), { recursive: true });
  const out = path.join(ROOT, ".data", `assignments_before_reset_${from}.json`);
  fs.writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log(`\nbacked up ${backup.length} assignments to ${path.relative(ROOT, out)}`);
}
console.log(
  APPLY
    ? `\napplied: ${dropped} assignments removed, ${created} lines written. Re-run the sheet sync now.`
    : "\ndry run — nothing changed. Re-run with --apply.",
);

// Report the roles the sheet staffs that the template has no line for; those
// are the only places the importer still has to invent a line.
const templateKeys = new Set(
  templates.map((t) => `${depts.get(t.department_id)}|${roles.get(t.role_id) ?? t.label ?? ""}`),
);
console.log("\ntemplate covers:");
for (const k of [...templateKeys].sort()) console.log(`  ${k.replace("|", " / ")}`);
