import { getGuides, getGuideData, getPlanningSetup } from "./data";
import { getWeeks } from "../schedule/data";
import { PlanningWorkspace } from "./planning-workspace";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { weekStartFor } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ guide?: string; week?: string }>;
}) {
  const { guide: guideParam, week: weekParam } = await searchParams;
  const [guides, setup, weeks, current] = await Promise.all([
    getGuides(),
    getPlanningSetup(),
    getWeeks(),
    getCurrentUser(),
  ]);
  const canEdit = current
    ? canEditModule(current.appUser, "planning")
    : false;

  const currentWeekStart = weekStartFor(new Date());
  const defaultWeek =
    weeks.find((w) => w.week_start === currentWeekStart) ??
    weeks.find((w) => w.week_start <= currentWeekStart) ??
    weeks[weeks.length - 1] ??
    null;
  const selectedWeekId =
    (weekParam && weeks.some((w) => w.id === weekParam)
      ? weekParam
      : defaultWeek?.id) ?? null;

  const selectedId =
    guideParam && guides.some((g) => g.id === guideParam)
      ? guideParam
      : guides[0]?.id ?? null;
  const guideData = selectedId ? await getGuideData(selectedId) : null;

  return (
    <PlanningWorkspace
      guides={guides}
      setup={setup}
      guideData={guideData}
      weeks={weeks}
      selectedWeekId={selectedWeekId}
      canEdit={canEdit}
    />
  );
}
