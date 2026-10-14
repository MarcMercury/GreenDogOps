import { PageHeader } from "../../_components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { getWeeks } from "@/features/scheduling/scheduling-grid/db/get-weeks";
import { getTemplates } from "@/features/scheduling/scheduling-grid/db/get-templates";
import { getTemplateWeekData } from "@/features/scheduling/scheduling-grid/db/get-template-week-data";
import { getSetupData } from "@/features/scheduling/setup/db/get-setup-data";
import { getApptTypeMappings } from "@/features/scheduling/setup/db/get-appt-type-mappings";
import { selectTemplateId } from "@/features/scheduling/setup/lib/select-template";
import { SetupManager } from "@/features/scheduling/setup/components/setup-manager";

export const dynamic = "force-dynamic";

export default async function ScheduleSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template: templateParam } = await searchParams;
  const [data, apptTypeMappings, templates, weeks, current] = await Promise.all([
    getSetupData(),
    getApptTypeMappings(),
    getTemplates(),
    getWeeks(),
    getCurrentUser(),
  ]);

  // Open the requested template, falling back to the first so the tab shows a
  // grid rather than an empty chooser.
  const selectedTemplateId = selectTemplateId(templates, templateParam);
  const templateWeek = selectedTemplateId
    ? await getTemplateWeekData(selectedTemplateId)
    : null;

  const canEdit = current ? canEditModule(current.appUser, "schedule") : false;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Set Up"
        description="Define departments, roles, shift lines, and who is eligible to fill them."
      />
      <SetupManager
        data={data}
        apptTypeMappings={apptTypeMappings}
        templates={templates}
        templateWeek={templateWeek}
        selectedTemplateId={selectedTemplateId}
        weeks={weeks}
        canEdit={canEdit}
        initialTab={templateParam ? "week-template" : undefined}
      />
    </div>
  );
}
