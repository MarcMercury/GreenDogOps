import { getSetupData } from "@/features/scheduling/setup/db/get-setup-data";
import { getAgendaCounts } from "@/features/scheduling/scheduling-grid/db/get-agenda-counts";
import { getTemplates } from "@/features/scheduling/scheduling-grid/db/get-templates";
import { getWeekData } from "@/features/scheduling/scheduling-grid/db/get-week-data";
import { getWeekDataFor } from "@/features/scheduling/scheduling-grid/db/get-week-data-for";
import { getWeekTimeOff } from "@/features/scheduling/scheduling-grid/db/get-week-time-off";
import { getWeeks } from "@/features/scheduling/scheduling-grid/db/get-weeks";
import { selectDefaultWeek } from "@/features/scheduling/scheduling-grid/lib/select-default-week";
import { EmptyWeekLayout } from "@/features/scheduling/scheduling-grid/components/empty-week-layout";
import { ScheduleGrid } from "@/features/scheduling/scheduling-grid/components/grid/schedule-grid";
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
  const defaultWeek = selectDefaultWeek(weeks, weekStartFor(new Date()));
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
    return <EmptyWeekLayout weeks={weeks.filter((w) => !w.is_template)} canEdit={canEdit} />;
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
