import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { reminderAppliesTo, type ReminderRule } from "@/lib/worklist/reminders";
import { PageHeader } from "../_components/ui";
import { ReminderList } from "../_work/reminder-form";

export const dynamic = "force-dynamic";

/** Personal reminders (any user), plus the shared ones that apply to them. */
export default async function RemindersPage() {
  const current = await requireUser();
  const user = current.appUser;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reminder_rule")
    .select("*")
    .or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
    .order("sort_order")
    .order("created_at");
  const rules = (data ?? []) as ReminderRule[];
  const mine = rules.filter((r) => r.owner_user_id === user.id);
  const shared = rules.filter((r) => r.owner_user_id === null && reminderAppliesTo(r, user));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Reminders"
        description="Recurring things to check. They show on your dashboard on the day they're due and stay there until you tick them off."
        actions={
          <Link href="/" className="text-sm font-medium text-emerald-700 hover:underline">
            ← Dashboard
          </Link>
        }
      />
      {error ? <p className="text-sm text-rose-700">Could not load reminders: {error.message}</p> : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">My reminders</h2>
        <ReminderList rules={mine} shared={false} canEdit={!error} empty="You haven't added any personal reminders." />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Shared reminders you get</h2>
        <p className="mb-2 text-xs text-slate-500">
          Set by admins for your role.{" "}
          {isAdminRole(user.role) ? (
            <Link href="/admin/reminders" className="text-emerald-700 hover:underline">
              Manage in Admin ▸ Reminders
            </Link>
          ) : null}
        </p>
        <ReminderList rules={shared} shared canEdit={false} empty="No shared reminders apply to you." />
      </section>
    </div>
  );
}
