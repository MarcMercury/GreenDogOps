import { PageHeader } from "../../_components/ui";
import { getSetupData, getApptTypeMappings, getTemplateWeekData, getWeeks } from "../data";
import { SetupManager } from "./setup-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ScheduleSetupPage() {
  const [data, apptTypeMappings, templateWeek, weeks, current] = await Promise.all([
    getSetupData(),
    getApptTypeMappings(),
    getTemplateWeekData(),
    getWeeks(),
    getCurrentUser(),
  ]);
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
        templateWeek={templateWeek}
        weeks={weeks}
        canEdit={canEdit}
      />
    </div>
  );
}
