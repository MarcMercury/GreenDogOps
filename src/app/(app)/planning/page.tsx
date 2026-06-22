import { getGuides, getGuideData, getPlanningSetup } from "./data";
import { PlanningWorkspace } from "./planning-workspace";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ guide?: string }>;
}) {
  const { guide: guideParam } = await searchParams;
  const [guides, setup, current] = await Promise.all([
    getGuides(),
    getPlanningSetup(),
    getCurrentUser(),
  ]);
  const canEdit = current
    ? canEditModule(current.appUser, "planning")
    : false;

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
      canEdit={canEdit}
    />
  );
}
