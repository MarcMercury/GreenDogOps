import { PageHeader } from "../_components/ui";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import type {
  MarketingEventSource,
  PersonOption,
} from "@/lib/marketing/types";
import { getCalendarItems, getGoogleSyncStatus, defaultRange } from "./data";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "calendar") : false;
  const canCreateEvent = current
    ? canEditModule(current.appUser, "marketing")
    : false;

  const supabase = await createClient();
  const range = defaultRange();
  const [items, syncStatus, sourcesRes, peopleRes] = await Promise.all([
    getCalendarItems(range.start, range.end),
    getGoogleSyncStatus(),
    supabase
      .from("marketing_event_source")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("person")
      .select("id, full_name, first_name, last_name")
      .in("status", ["employee", "contractor"])
      .order("full_name", { ascending: true }),
  ]);

  const eventSources = (sourcesRes.data ?? []) as MarketingEventSource[];
  const people = (peopleRes.data ?? []) as PersonOption[];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Company Calendar"
        title="Calendar"
        description="Google Calendar events plus CE, interviews, time off, and custom items in one view."
      />
      <CalendarView
        items={items}
        canEdit={canEdit}
        canCreateEvent={canCreateEvent}
        syncStatus={syncStatus}
        eventSources={eventSources}
        people={people}
      />
    </div>
  );
}
