import { createAdminClient } from "@/lib/supabase/admin";
import { Panel } from "../_components";

export const dynamic = "force-dynamic";

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  entity: string | null;
  summary: string | null;
  created_at: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5">When</th>
                <th className="px-3 py-2.5">Actor</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-5 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">
                    {when(e.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {e.actor_email ?? "system"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-slate-700">
                    {e.summary ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
