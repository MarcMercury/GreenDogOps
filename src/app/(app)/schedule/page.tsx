import {
  getSetupData,
  getWeeks,
  getWeekData,
  getWeekDataFor,
  getWeekTimeOff,
  getAgendaCounts,
  getTemplates,
} from "./data";
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
  const [weeks, setup, current, templates] = await Promise.all([
    getWeeks(),
    getSetupData(),
    getCurrentUser(),
    getTemplates(),
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

  // The week row is already in `weeks`, so the grid, time-off and agenda
  // queries can all start together. Looking the week up first instead would
  // serialise them behind it, and behind each other.
  const selectedWeek = selectedId
    ? weeks.find((w) => w.id === selectedId) ?? null
    : null;

  const [weekData, timeOff, agendaCounts] = selectedWeek
    ? await Promise.all([
        getWeekDataFor(selectedWeek),
        getWeekTimeOff(selectedWeek.week_start),
        getAgendaCounts(selectedWeek.week_start),
      ])
    : // A week id in the URL that is not in the list (the template, or one just
      // deleted) still has to be fetched the long way.
      selectedId
      ? await (async () => {
          const wd = await getWeekData(selectedId);
          if (!wd) return [null, [], []] as const;
          const [to, ac] = await Promise.all([
            getWeekTimeOff(wd.week.week_start),
            getAgendaCounts(wd.week.week_start),
          ]);
          return [wd, to, ac] as const;
        })()
      : [null, [], []];

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

  return (
    <ScheduleGrid
      weeks={weeks}
      weekData={weekData}
      setup={setup}
      timeOff={timeOff}
      agendaCounts={agendaCounts}
      canEdit={canEdit}
      templates={templates}
    />
  );
}
