import { createAdminClient } from "@/lib/supabase/admin";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import { LocationsView } from "./locations-view";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("location")
    .select(LOCATION_COLUMNS)
    .order("is_active", { ascending: false })
    .order("sort_order")
    .order("name");

  const locations = (data ?? []) as unknown as Location[];

  return <LocationsView locations={locations} />;
}
