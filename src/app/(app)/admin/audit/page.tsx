import { createAdminClient } from "@/lib/supabase/admin";
import { Panel } from "../_components";
import { AuditTable, type AuditEntry } from "./audit-table";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("audit_log")
    .select("id, actor_email, action, entity, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const entries = (data ?? []) as AuditEntry[];

  return (
    <Panel
      title="Audit log"
      description={`${entries.length} most recent action(s).`}
    >
      {entries.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          No activity recorded yet. Actions like granting access, changing
          roles, and updating settings will appear here.
        </p>
      ) : (
        <AuditTable entries={entries} />
      )}
    </Panel>
  );
}
