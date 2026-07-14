import {
  getSetupData,
  getWeeks,
  getWeekData,
  getActiveGuides,
  getCapacityRules,
  getAgendaCounts,
} from "../schedule/data";
import { WeekPicker } from "../schedule/week-picker";
import { CapacityView } from "./capacity-view";
import { CapacityRulesManager } from "./capacity-rules";
import { PageHeader } from "../_components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { weekStartFor } from "@/lib/schedule/types";
import { computeWeekCapacity } from "@/lib/planning/resolve";

export const dynamic = "force-dynamic";

export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const [weeks, setup, current, guides, rules] = await Promise.all([
    getWeeks(),
    getSetupData(),
    getCurrentUser(),
    getActiveGuides(),
    getCapacityRules(),
  ]);
  const canEdit = current ? canEditModule(current.appUser, "schedule") : false;

  // The schedule "areas" that capacity rules govern: planning departments.
  const areas = setup.departments.filter((d) => d.show_in_planning);

  const currentWeekStart = weekStartFor(new Date());
  const defaultWeek =
    weeks.find((w) => w.week_start === currentWeekStart) ??
    weeks.find((w) => w.week_start <= currentWeekStart) ??
    weeks[weeks.length - 1] ??
    null;
  const selectedId = weekParam ?? defaultWeek?.id ?? null;
  const weekData = selectedId ? await getWeekData(selectedId) : null;

  const agendaCounts = weekData
    ? await getAgendaCounts(weekData.week.week_start)
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Daily Capacity"
        description="Each location's departments, with the staffing scheduled in each — DVMs, Techs, Leads, Dentals, DAs and Floats. A department's staffing drives its appointment capacity; the matching planning guide and bookable-appointment totals resolve here."
      />
      <WeekPicker
        weeks={weeks}
        selectedId={weekData?.week.id ?? null}
        basePath="/capacity"
      />
      {weekData ? (
        <CapacityView
          cells={[
            ...computeWeekCapacity(
              weekData.assignments,
              weekData.lines,
              setup.roles,
              setup.departments,
              guides,
              rules,
            ).values(),
          ]}
          locations={setup.locations}
          weekId={weekData.week.id}
          weekStart={weekData.week.week_start}
          agendaCounts={agendaCounts}
          canEdit={canEdit}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">
            No schedule week yet. Create one on the Scheduling grid first.
          </p>
        </div>
      )}
      <CapacityRulesManager
        areas={areas.map((a) => ({ id: a.id, name: a.name, color: a.color }))}
        locations={setup.locations.map((l) => ({
          id: l.id,
          name: l.name,
          short_code: l.short_code,
        }))}
        rules={rules}
        canEdit={canEdit}
      />
    </div>
  );
}
