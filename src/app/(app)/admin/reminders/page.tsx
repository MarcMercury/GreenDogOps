import { requireAdminView } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReminderRule } from "@/lib/worklist/reminders";
import { Panel } from "../_components";
import { ReminderList } from "../../_work/reminder-form";

export const dynamic = "force-dynamic";

/** Admin ▸ Reminders: shared recurring reminders, targeted by role and module. */
export default async function AdminRemindersPage() {
  const current = await requireAdminView();
  const canEdit = isAdminRole(current.appUser.role);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reminder_rule")
    .select("*")
    .is("owner_user_id", null)
    .order("sort_order")
    .order("created_at");

  return (
    <Panel
      title="Shared reminders"
      description="Recurring reminders on people's dashboards, by role. A module limits it to people who can open that module. People can also add their own on /reminders."
    >
      {error ? (
        <p className="text-sm text-rose-700">Could not load reminders: {error.message}</p>
      ) : (
        <ReminderList
          rules={(data ?? []) as ReminderRule[]}
          shared
          canEdit={canEdit}
          empty="No shared reminders yet."
        />
      )}
    </Panel>
  );
}
