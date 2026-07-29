import { PageHeader } from "../../_components/ui";
import { getSetupData, getApptTypeMappings } from "../data";
import { SetupManager } from "./setup-manager";

export const dynamic = "force-dynamic";

export default async function ScheduleSetupPage() {
  const [data, apptTypeMappings] = await Promise.all([
    getSetupData(),
    getApptTypeMappings(),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Set Up"
        description="Define departments, roles, shift lines, and who is eligible to fill them."
      />
      <SetupManager data={data} apptTypeMappings={apptTypeMappings} />
    </div>
  );
}
