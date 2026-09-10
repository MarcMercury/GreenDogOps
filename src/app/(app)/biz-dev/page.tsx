import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, canEditModule } from "@/lib/auth/permissions";
import { PageHeader } from "../_components/ui";
import { SectionCard } from "../reporting/charts";
import { BizDevWorkspace } from "./biz-dev-workspace";
import { getPlanningTrackRules } from "./data";

export const dynamic = "force-dynamic";

export default async function BizDevPage() {
  const current = await getCurrentUser();

  // Shares the Reporting module gate: the planner reads the same invoice- and
  // agenda-derived numbers, so nav hiding alone is not enough.
  if (!current || !canAccessModule(current.appUser, "reporting")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Biz Dev"
          description="Capacity and revenue planning by clinic."
        />
        <SectionCard
          title="Admin access required"
          description="The Biz Dev workspace is limited to administrators."
        >
          <p className="text-sm text-slate-500">
            You don&apos;t have access to this page. If you believe you should,
            ask an administrator to grant you the Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  // The Planning Guide tab follows the same Planning Guide Setup rules as the
  // Operations guides: appointment type → department, department → tracks.
  const rules = await getPlanningTrackRules();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Biz Dev"
        description="Model each clinic's day — plan the appointment mix, then convert it into a planning guide."
      />
      <BizDevWorkspace
        canEdit={canEditModule(current.appUser, "reporting")}
        rules={rules}
      />
    </div>
  );
}
