import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import { getTimeClockAdminData } from "@/lib/timeclock/admin";
import { LocationsView } from "./locations-view";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const admin = createAdminClient();
  const [{ data }, clinics, current] = await Promise.all([
    admin
      .from("location")
      .select(LOCATION_COLUMNS)
      .order("is_active", { ascending: false })
      .order("sort_order")
      .order("name"),
    getTimeClockAdminData(),
    getCurrentUser({ allowPreview: true }),
  ]);

  const locations = (data ?? []) as unknown as Location[];
  // Owner/Admin edit time-clock settings; Executives view (Admin layout gate).
  const canEditTimeClock = !!current && isAdminRole(current.appUser.role) && !current.viewAs;

  return (
    <LocationsView
      locations={locations}
      timeClock={{
        clinics,
        canEdit: canEditTimeClock,
        mapsKey: process.env.GOOGLE_MAPS_PUBLIC_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
      }}
    />
  );
}
