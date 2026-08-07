import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../../_components/ui";
import { SectionCard } from "../charts";
import { SmartChat } from "./smart-chat";

export const dynamic = "force-dynamic";

export default async function SmartReportPage() {
  const current = await getCurrentUser();

  if (!current || !canAccessModule(current.appUser, "reporting")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Smart Report"
          description="Ask questions about your data in plain English."
        />
        <SectionCard
          title="Admin access required"
          description="Smart Report is limited to administrators."
        >
          <p className="text-sm text-slate-500">
            You don&apos;t have access to this page. If you believe you should,
            ask an administrator to grant you the Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Smart Report"
        description="Ask anything about patients, clients, revenue, appointments or staff — answered from live data."
        actions={
          <Link
            href="/reporting"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ← Reporting
          </Link>
        }
      />
      <SmartChat />
    </div>
  );
}
