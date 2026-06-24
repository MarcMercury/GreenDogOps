import { getSetupData, getWeeks, getWeekData, getActiveGuides } from "../schedule/data";
import { WeekPicker } from "../schedule/week-picker";
import { CapacityView } from "./capacity-view";
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
  const [weeks, setup, current, guides] = await Promise.all([
    getWeeks(),
    getSetupData(),
    getCurrentUser(),
    getActiveGuides(),
  ]);
  const canEdit = current ? canEditModule(current.appUser, "schedule") : false;

  const currentWeekStart = weekStartFor(new Date());
  const defaultWeek =
    weeks.find((w) => w.week_start === currentWeekStart) ??
    weeks.find((w) => w.week_start <= currentWeekStart) ??
    weeks[weeks.length - 1] ??
    null;
  const selectedId = weekParam ?? defaultWeek?.id ?? null;
  const weekData = selectedId ? await getWeekData(selectedId) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Daily Capacity"
        description="Each day's staffing summary — DVMs, Techs, Leads, Dentals, DAs and Floats — rolled up per location. Build the schedule first; the matching planning guide and bookable-appointment totals resolve here from the day's full staffing."
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
            ).values(),
          ]}
          locations={setup.locations}
          weekId={weekData.week.id}
          canEdit={canEdit}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">
            No schedule week yet. Create one on the Scheduling grid first.
          </p>
        </div>
      )}
    </div>
  );
}
