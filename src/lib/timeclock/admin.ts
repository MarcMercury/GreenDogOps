import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { formatAddress } from "@/lib/shared/locations";
import { clinicHealth, type ClinicHealth } from "./clinic-settings";
import type { ClockPolicy } from "./location-check";

// Time-clock settings for Admin ▸ Locations. Service role; the page is behind the Admin layout
// (Owner/Admin edit, Executive view).

export interface AdminNetwork {
  id: string;
  label: string;
  cidr: string;
  is_active: boolean;
  added_via: "manual" | "captured";
  added_by_name: string | null;
  created_at: string;
  last_matched_at: string | null;
  match_count: number;
}

export interface AdminClinic {
  id: string;
  name: string;
  kind: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  gps_max_accuracy_m: number;
  clock_policy: ClockPolicy;
  networks: AdminNetwork[];
  stats: { punches24h: number; punches7d: number; offsite7d: number; unchecked7d: number };
  health: ClinicHealth;
}

interface LocationRow {
  id: string;
  name: string;
  display_name: string | null;
  kind: string;
  sort_order: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  gps_max_accuracy_m: number;
  clock_policy: ClockPolicy;
}

export async function getTimeClockAdminData(now: Date = new Date()): Promise<AdminClinic[]> {
  const admin = createAdminClient();
  const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since24h = now.getTime() - 86_400_000;

  const [locRes, netRes, punchRes] = await Promise.all([
    admin
      .from("location")
      .select(
        "id, name, display_name, kind, sort_order, address_line1, address_line2, city, state, postal_code, " +
          "latitude, longitude, geofence_radius_m, gps_max_accuracy_m, clock_policy",
      )
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    admin
      .from("location_network")
      .select("id, location_id, label, cidr, is_active, added_via, added_by, created_at, last_matched_at, match_count")
      .order("created_at"),
    fetchAllRows<{ location_id: string | null; matched_location_id: string | null; location_check: string; punched_at: string }>((a, b) =>
      admin
        .from("time_punch")
        .select("location_id, matched_location_id, location_check, punched_at")
        .gte("punched_at", since7d)
        .order("id")
        .range(a, b),
    ),
  ]);
  if (locRes.error) throw new Error(`Could not load locations: ${locRes.error.message}`);
  if (netRes.error) throw new Error(`Could not load approved networks: ${netRes.error.message}`);
  if (punchRes.error) throw new Error(`Could not load recent punches: ${punchRes.error.message}`);

  const nets = (netRes.data ?? []) as (Omit<AdminNetwork, "added_by_name"> & { location_id: string; added_by: string | null })[];
  const adderIds = [...new Set(nets.map((n) => n.added_by).filter((v): v is string => !!v))];
  const adders = new Map<string, string>();
  if (adderIds.length) {
    const { data } = await admin.from("app_user").select("id, full_name, email").in("id", adderIds);
    for (const u of (data ?? []) as { id: string; full_name: string | null; email: string }[]) {
      adders.set(u.id, u.full_name || u.email);
    }
  }

  return ((locRes.data ?? []) as unknown as LocationRow[]).map((l) => {
    const networks: AdminNetwork[] = nets
      .filter((n) => n.location_id === l.id)
      .map((n) => ({
        id: n.id,
        label: n.label,
        cidr: String(n.cidr),
        is_active: n.is_active,
        added_via: n.added_via,
        added_by_name: n.added_by ? adders.get(n.added_by) ?? null : null,
        created_at: n.created_at,
        last_matched_at: n.last_matched_at,
        match_count: n.match_count,
      }));
    // A punch belongs to the clinic it was scheduled at, or matched to when unscheduled.
    const here = punchRes.data.filter((p) => (p.location_id ?? p.matched_location_id) === l.id);
    const stats = {
      punches24h: here.filter((p) => new Date(p.punched_at).getTime() >= since24h).length,
      punches7d: here.length,
      offsite7d: here.filter((p) => p.location_check === "off_site").length,
      unchecked7d: here.filter((p) => p.location_check === "not_checked").length,
    };
    const active = networks.filter((n) => n.is_active);
    const lastNetworkMatch =
      active.map((n) => n.last_matched_at).filter((v): v is string => !!v).sort().at(-1) ?? null;
    return {
      id: l.id,
      name: l.display_name || l.name,
      kind: l.kind,
      address: formatAddress(l),
      latitude: l.latitude,
      longitude: l.longitude,
      geofence_radius_m: l.geofence_radius_m,
      gps_max_accuracy_m: l.gps_max_accuracy_m,
      clock_policy: l.clock_policy,
      networks,
      stats,
      health: clinicHealth(
        {
          policy: l.clock_policy,
          hasGeofence: l.latitude !== null && l.longitude !== null,
          activeNetworks: active.length,
          lastNetworkMatch,
          punches24h: stats.punches24h,
          punches7d: stats.punches7d,
          offsite7d: stats.offsite7d,
        },
        now,
      ),
    };
  });
}
