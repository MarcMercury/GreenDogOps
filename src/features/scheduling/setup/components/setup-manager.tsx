"use client";

import { useState } from "react";
import type { ApptTypeDeptMapping, SchedWeek } from "@/lib/schedule/types";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import type { SubTab } from "@/features/scheduling/setup/types/sub-tab";
import { SetupSubTabBar } from "@/features/scheduling/setup/components/setup-sub-tab-bar";
import { DepartmentsTab } from "@/features/scheduling/setup/components/departments-tab";
import { RolesTab } from "@/features/scheduling/setup/components/roles-tab";
import { ShiftsTab } from "@/features/scheduling/setup/components/shifts-tab";
import { WeekTemplateTab } from "@/features/scheduling/setup/components/week-template-tab";
import { PlanningGuideTab } from "@/features/scheduling/setup/components/planning-guide-tab";
import { EmployeesTab } from "@/features/scheduling/setup/components/employees-tab";
import { LocationsTab } from "@/features/scheduling/setup/components/locations-tab";

/** Scheduling ▸ Set Up: the sub-tab bar and whichever tab is open. */
export function SetupManager({
  data,
  apptTypeMappings,
  templates,
  templateWeek,
  selectedTemplateId,
  weeks,
  canEdit,
  initialTab = "departments",
}: {
  data: SetupData;
  apptTypeMappings: ApptTypeDeptMapping[];
  templates: SchedWeek[];
  templateWeek: WeekData | null;
  selectedTemplateId: string | null;
  weeks: SchedWeek[];
  canEdit: boolean;
  /** Sub-tab to open on load. The tabs are local state, so a link to a
   *  specific template would otherwise land on Departments. */
  initialTab?: SubTab;
}) {
  const [tab, setTab] = useState<SubTab>(initialTab);

  return (
    <div className="space-y-4">
      <SetupSubTabBar active={tab} onSelect={setTab} />

      {tab === "departments" && <DepartmentsTab data={data} />}
      {tab === "roles" && <RolesTab data={data} />}
      {tab === "shifts" && <ShiftsTab data={data} />}
      {tab === "week-template" && (
        <WeekTemplateTab
          data={data}
          templates={templates}
          templateWeek={templateWeek}
          selectedTemplateId={selectedTemplateId}
          weeks={weeks}
          canEdit={canEdit}
        />
      )}
      {tab === "planning-guide" && (
        <PlanningGuideTab data={data} mappings={apptTypeMappings} />
      )}
      {tab === "employees" && <EmployeesTab data={data} />}
      {tab === "locations" && <LocationsTab data={data} />}
    </div>
  );
}
