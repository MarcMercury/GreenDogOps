import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, canUseSmartReport } from "@/lib/auth/permissions";
import { smartScopeFor } from "@/lib/reporting/smart-scope";
import { PageHeader } from "../../_components/ui";
import { SectionCard } from "../charts";
import { SmartChat } from "./smart-chat";

export const dynamic = "force-dynamic";

export default async function SmartReportPage() {
  const current = await getCurrentUser();

  if (!current || !canUseSmartReport(current.appUser)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Smart Report"
          description="Ask questions about your data in plain English."
        />
        <SectionCard
          title="Access required"
          description="Smart Report is not available on your account."
        >
          <p className="text-sm text-slate-500">
            If you believe you should have it, ask an administrator to grant you
            the Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  const scope = smartScopeFor(current.appUser.role);
  const limits = [
    scope.canViewCompensation ? null : "employee pay, wages and benefits",
    scope.canViewHrRecords ? null : "confidential employee records",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Smart Report"
        description="Ask anything about patients, clients, revenue, appointments or staff — answered from live data."
        actions={
          canAccessModule(current.appUser, "reporting") ? (
            <Link
              href="/reporting"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Reporting
            </Link>
          ) : null
        }
      />
      {limits.length ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Your access level excludes {limits.join(" and ")}. Questions about that
          data will come back unanswered.
        </p>
      ) : null}
      <SmartChat />
    </div>
  );
}
