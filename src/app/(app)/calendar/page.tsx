import { PageHeader } from "../_components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { getCalendarItems, defaultRange } from "./data";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "calendar") : false;

  const range = defaultRange();
  const items = await getCalendarItems(range.start, range.end);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Company Calendar"
        title="Calendar"
        description="Google Calendar events plus CE, interviews, time off, and custom items in one view."
      />
      <CalendarView items={items} canEdit={canEdit} />
    </div>
  );
}
