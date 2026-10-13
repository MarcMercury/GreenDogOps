/**
 * One-off: give every active employee/contractor with an email an active
 * Green Dog Ops login (app_user) at the given role. Sends NO email.
 *
 * - Reuses the shared Supabase Auth user when one exists for the email
 *   (auth.users is shared with EmployeeGMGDD); otherwise creates one with a
 *   random password and email_confirm=true, which sends nothing.
 * - Inserts app_user only for people with no login yet (by person_id or
 *   email); never updates an existing app_user row.
 * - Writes one audit_log entry per account (action user.access_granted).
 *
 * Usage (production writes need explicit owner authorization):
 *   npx --yes tsx@4 scripts/provision_logins.mts                 # dry run
 *   npx --yes tsx@4 scripts/provision_logins.mts --apply          # write
 *   npx --yes tsx@4 scripts/provision_logins.mts --apply --role staff
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["staff", "employee"] as const;
type Role = (typeof ROLES)[number];

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const roleArg = args.includes("--role") ? args[args.indexOf("--role") + 1] : "staff";
if (!(ROLES as readonly string[]).includes(roleArg)) throw new Error(`--role must be one of ${ROLES.join(", ")}`);
const role = roleArg as Role;

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const schema = env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || "greendogops";
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
if (schema !== "greendogops") throw new Error(`refusing schema ${schema}`);

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema },
});

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

async function authUsersByEmail(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) map.set(norm(u.email), u.id);
    if (data.users.length < 1000) break;
  }
  return map;
}

async function main() {
  const [peopleRes, usersRes, empRes] = await Promise.all([
    supabase
      .from("person")
      .select("id, email, full_name, first_name, last_name, status, is_active")
      .eq("is_active", true)
      .in("status", ["employee", "contractor"])
      .limit(5000),
    supabase.from("app_user").select("id, email, person_id").limit(5000),
    supabase.from("person_employment").select("person_id, adp_job_title, offer_title").limit(5000),
  ]);
  for (const r of [peopleRes, usersRes, empRes]) if (r.error) throw r.error;

  const people = peopleRes.data ?? [];
  const users = usersRes.data ?? [];
  const usedPerson = new Set(users.map((u) => u.person_id).filter(Boolean));
  const usedEmail = new Set(users.map((u) => norm(u.email)));
  const usedId = new Set(users.map((u) => u.id));
  const titleBy = new Map(
    (empRes.data ?? []).map((e) => [e.person_id, e.adp_job_title ?? e.offer_title ?? null] as const),
  );

  const candidates = people.filter((p) => norm(p.email) && !usedPerson.has(p.id) && !usedEmail.has(norm(p.email)));
  const emails = candidates.map((p) => norm(p.email));
  if (new Set(emails).size !== emails.length) throw new Error("duplicate emails among candidates; resolve first");

  const authByEmail = await authUsersByEmail();
  const reuse = candidates.filter((p) => authByEmail.has(norm(p.email)));
  const create = candidates.filter((p) => !authByEmail.has(norm(p.email)));
  const idClash = reuse.filter((p) => usedId.has(authByEmail.get(norm(p.email))!));

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "dry-run",
    role,
    activeRoster: people.length,
    noEmail: people.filter((p) => !norm(p.email)).length,
    alreadyHaveLogin: people.length - candidates.length - people.filter((p) => !norm(p.email)).length,
    toProvision: candidates.length,
    reuseSharedAuthUser: reuse.length,
    createAuthUser: create.length,
    authIdAlreadyAnAppUser: idClash.length,
  }, null, 2));
  if (idClash.length) throw new Error("an existing auth id is already an app_user under another email; resolve first");
  if (!apply) return;

  let created = 0, inserted = 0, skipped = 0;
  const failures: string[] = [];
  for (const p of candidates) {
    const email = norm(p.email);
    const fullName = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
    try {
      let authId = authByEmail.get(email) ?? null;
      if (!authId) {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: `${crypto.randomUUID()}aA1!`,
          email_confirm: true,
          user_metadata: fullName ? { full_name: fullName } : undefined,
        });
        if (error || !data.user) throw error ?? new Error("createUser returned no user");
        authId = data.user.id;
        created++;
      }
      const { data: rows, error } = await supabase
        .from("app_user")
        .upsert(
          {
            id: authId,
            email,
            full_name: fullName,
            title: titleBy.get(p.id) ?? null,
            role,
            is_active: true,
            person_id: p.id,
            notes: "Provisioned in bulk 2026-10-13 (time-clock go-live, Gate 1 item 2). No invite sent.",
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      if (!rows?.length) { skipped++; continue; }
      inserted++;
      await supabase.from("audit_log").insert({
        actor_id: null,
        actor_email: "script:provision_logins",
        action: "user.access_granted",
        entity: "app_user",
        entity_id: authId,
        summary: `Granted ${email} access as ${role} (bulk provisioning, no invite sent)`,
        metadata: { person_id: p.id, auth_user: authByEmail.has(email) ? "reused" : "created" },
      });
    } catch (e) {
      failures.push(`${p.id}: ${(e as Error).message}`);
    }
  }
  console.log(JSON.stringify({ authUsersCreated: created, appUsersInserted: inserted, skipped, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
