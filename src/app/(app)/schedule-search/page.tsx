import { requireUser } from "@/lib/auth/session";
import { getSearchPeople } from "./data";
import { ScheduleSearchWorkspace } from "./search-workspace";

export const dynamic = "force-dynamic";

export default async function ScheduleSearchPage() {
  await requireUser();
  const people = await getSearchPeople();
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ScheduleSearchWorkspace people={people} />
    </div>
  );
}
