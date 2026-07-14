import { getSetupData, getWeeks, getWeekData, getWeekTimeOff, getAgendaCounts } from "./data";
import { ScheduleGrid } from "./schedule-grid";
import { WeekPicker } from "./week-picker";
import { PageHeader } from "../_components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { weekStartFor } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const [weeks, setup, current] = await Promise.all([
    getWeeks(),
    getSetupData(),
    getCurrentUser(),
  ]);
  const canEdit = current ? canEditModule(current.appUser, "schedule") : false;

  // Default to the current week (or the most recent week on/before today),
  // falling back to the newest week if everything is in the future.
  const currentWeekStart = weekStartFor(new Date());
  const defaultWeek =
    weeks.find((w) => w.week_start === currentWeekStart) ??
    weeks.find((w) => w.week_start <= currentWeekStart) ??
    weeks[weeks.length - 1] ??
    null;
  const selectedId = weekParam ?? defaultWeek?.id ?? null;
  const weekData = selectedId ? await getWeekData(selectedId) : null;
  if (!weekData) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Scheduling"
          title="Weekly Grid"
          description="Build, approve, and publish the visual weekly schedule."
        />
        <WeekPicker weeks={weeks} selectedId={null} />
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">
            No schedule week yet. Pick a week above to create one.
          </p>
        </div>
      </div>
    );
  }

  const timeOff = await getWeekTimeOff(weekData.week.week_start);

  const agendaCounts = await getAgendaCounts(weekData.week.week_start);

  return <ScheduleGrid weeks={weeks} weekData={weekData} setup={setup} timeOff={timeOff} agendaCounts={agendaCounts} canEdit={canEdit} />;
}
