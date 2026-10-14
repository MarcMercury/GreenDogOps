import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../_components/ui";
import { SectionCard } from "../reporting/charts";
import { EmpReportPanel } from "./emp-report-panel";

export const dynamic = "force-dynamic";

// Emp Reporting lives as the Employees tab on /reporting. This route stays for
// old links and for anyone granted Emp Reporting without the Reporting module.
export default async function EmpReportingPage() {
  const current = await getCurrentUser();

  // Payroll data is sensitive — admin-only by default, same gate as Reporting.
  if (!current || !canAccessModule(current.appUser, "emp_reporting")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Business Intelligence"
          title="Emp Reporting"
          description="Roster payroll analytics."
        />
        <SectionCard
          title="Admin access required"
          description="Employee payroll reporting is limited to administrators."
        >
          <p className="text-sm text-slate-500">
            You don&apos;t have access to this page. If you believe you should,
            ask an administrator to grant you the Emp Reporting module.
          </p>
        </SectionCard>
      </div>
    );
  }

  if (canAccessModule(current.appUser, "reporting")) {
    redirect("/reporting?tab=employees");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Business Intelligence"
        title="Emp Reporting"
        description="Average salaries by role, pay outliers, and company averages."
      />
      <EmpReportPanel current={current} />
    </div>
  );
}
