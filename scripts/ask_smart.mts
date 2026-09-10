// Ask the Smart Report a question end-to-end against live data (no dev server,
// no auth). See the "Local end-to-end test recipe" in the smart-report notes.
//
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/ask_smart.mts "question"
//
// Set GDO_SMART_ROLE (owner | executive | manager | schedule_admin | staff...)
// to test what a given role's data scope can and cannot answer.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { createAdminClient } = await import("@/lib/supabase/admin");
const { askSmartReport } = await import("@/lib/reporting/smart");
const { smartScopeFor } = await import("@/lib/reporting/smart-scope");

const role = (process.env.GDO_SMART_ROLE ?? "owner") as Parameters<typeof smartScopeFor>[0];
const question = process.argv.slice(2).join(" ");
const result = await askSmartReport(createAdminClient(), question, smartScopeFor(role));
console.log("ROLE:", role);
console.log("Q:", question);
console.log("SQL:", result.sql);
console.log("ANSWER:", result.answer);
console.log("ROWS:", JSON.stringify(result.rows.slice(0, 5), null, 1).slice(0, 900));
