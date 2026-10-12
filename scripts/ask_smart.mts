// Ask Ziggy (the Smart Report engine) a question end-to-end against live data
// (no dev server, no auth). Read-only. See docs/agent/lessons.md for the recipe.
//
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/ask_smart.mts "question"
//
// Set GDO_SMART_ROLE (owner | executive | manager | schedule_admin | staff...)
// to test what a given role's data scope can and cannot answer. Set
// GDO_ASKER_EMAIL to an app_user email to include that user's own shifts/PTO
// ("when am I working next?").
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { createAdminClient } = await import("@/lib/supabase/admin");
const { askSmartReport } = await import("@/lib/reporting/smart");
const { smartScopeFor } = await import("@/lib/reporting/smart-scope");

const { formatAskerContext, getAskerFacts } = await import("@/lib/reporting/ziggy-context");

const role = (process.env.GDO_SMART_ROLE ?? "owner") as Parameters<typeof smartScopeFor>[0];
const question = process.argv.slice(2).join(" ");
const admin = createAdminClient();
let asker: string | null = null;
if (process.env.GDO_ASKER_EMAIL) {
  const { data } = await admin
    .from("app_user")
    .select("full_name, role, person_id, email")
    .ilike("email", process.env.GDO_ASKER_EMAIL)
    .maybeSingle();
  if (data) asker = formatAskerContext(await getAskerFacts(admin, data, data.email));
}
const result = await askSmartReport(admin, question, smartScopeFor(role), [], asker);
console.log("ROLE:", role);
console.log("Q:", question);
console.log("SQL:", result.sql);
console.log("ANSWER:", result.answer);
console.log("ROWS:", JSON.stringify(result.rows.slice(0, 5), null, 1).slice(0, 900));
