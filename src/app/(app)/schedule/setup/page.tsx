import { PageHeader } from "../../_components/ui";
import {
  getSetupData,
  getApptTypeMappings,
  getTemplates,
  getTemplateWeekData,
  getWeeks,
} from "../data";
import { SetupManager } from "./setup-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";

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
  const selectedTemplateId =
    (templateParam && templates.some((t) => t.id === templateParam)
      ? templateParam
      : templates[0]?.id) ?? null;
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
