"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { canAccessModule, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestMeta } from "@/lib/security/rate-limit";
import { formatAddress } from "@/lib/shared/locations";
import { validateClockSettings } from "@/lib/timeclock/clinic-settings";
import { geocodeAddress } from "@/lib/timeclock/geocode";
import { formatIp, hostCidr, isPublicIp, parseIp, validateClinicNetwork } from "@/lib/timeclock/ip";
import {
  diagnoseAll,
  evaluateLocation,
  type ClinicDiagnosis,
  type LocationCheck,
} from "@/lib/timeclock/location-check";
import { getClockLocations } from "@/lib/timeclock/server";

// Time-clock settings on Admin ▸ Locations (go-live plan §F, D11). Owner/Admin edit; Executive views
// (the Admin layout already requires Admin access). Every change is audited.

export type AdminTcResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = "/admin/locations";

async function editorGate(): Promise<{ ok: true; current: CurrentUser } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!isAdminRole(current.appUser.role) || !canAccessModule(current.appUser, "admin")) {
    return { ok: false, error: "Only Owners and Admins can change time-clock settings." };
  }
  return { ok: true, current };
}

async function audit(
  current: CurrentUser,
  action: string,
  entity: string,
  entityId: string,
  summary: string,
  metadata: Record<string, unknown>,
) {
  await recordAudit({ actorId: current.authId, actorEmail: current.email, action, entity, entityId, summary, metadata });
}

interface ClinicRow {
  id: string;
  name: string;
  display_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  gps_max_accuracy_m: number;
  clock_policy: string;
}

async function loadClinic(id: string): Promise<ClinicRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await createAdminClient()
    .from("location")
    .select(
      "id, name, display_name, address_line1, address_line2, city, state, postal_code, latitude, longitude, geofence_radius_m, gps_max_accuracy_m, clock_policy",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as ClinicRow | null) ?? null;
}

const clinicName = (c: ClinicRow) => c.display_name || c.name;

export type GeocodeClinicResult =
  | { ok: true; message: string; latitude: number; longitude: number }
  | { ok: false; error: string };

/** "Use clinic address": geocode the stored address and set the geofence centre. */
export async function geocodeClinic(locationId: string): Promise<GeocodeClinicResult> {
  const gate = await editorGate();
  if (!gate.ok) return gate;
  const clinic = await loadClinic(locationId);
  if (!clinic) return { ok: false, error: "Unknown location." };
  const address = formatAddress(clinic);
  if (!clinic.address_line1 || !address) {
    return { ok: false, error: "This location has no street address. Add it under Admin ▸ Locations." };
  }

  const geo = await geocodeAddress(address);
  if (!geo.ok) return geo;
  const { latitude, longitude, precise, precision, formattedAddress } = geo.hit;
  const { error } = await createAdminClient().from("location").update({ latitude, longitude }).eq("id", clinic.id);
  if (error) return { ok: false, error: `Could not save: ${error.message}` };

  await audit(gate.current, "timeclock.geofence_geocoded", "location", clinic.id, `Set ${clinicName(clinic)} geofence centre from its address`, {
    before: { latitude: clinic.latitude, longitude: clinic.longitude },
    after: { latitude, longitude },
    address,
    google_address: formattedAddress,
    precision,
  });
  revalidatePath(PAGE);
  return {
    ok: true,
    latitude,
    longitude,
    message: precise
      ? `Pin set at ${formattedAddress}.`
      : `Pin set at ${formattedAddress}, but Google's match is approximate (${precision}). Drag the pin onto the building and save.`,
  };
}

export async function saveClinicClockSettings(formData: FormData): Promise<AdminTcResult> {
  const gate = await editorGate();
  if (!gate.ok) return gate;
  const clinic = await loadClinic(String(formData.get("location_id") ?? ""));
  if (!clinic) return { ok: false, error: "Unknown location." };
  const v = validateClockSettings({
    latitude: String(formData.get("latitude") ?? ""),
    longitude: String(formData.get("longitude") ?? ""),
    radius: String(formData.get("radius") ?? ""),
    accuracy: String(formData.get("accuracy") ?? ""),
    policy: String(formData.get("policy") ?? ""),
  });
  if (!v.ok) return v;
  const { error } = await createAdminClient().from("location").update(v.value).eq("id", clinic.id);
  if (error) return { ok: false, error: `Could not save: ${error.message}` };

  await audit(gate.current, "timeclock.location_settings", "location", clinic.id, `Updated time-clock settings for ${clinicName(clinic)}`, {
    before: {
      latitude: clinic.latitude,
      longitude: clinic.longitude,
      geofence_radius_m: clinic.geofence_radius_m,
      gps_max_accuracy_m: clinic.gps_max_accuracy_m,
      clock_policy: clinic.clock_policy,
    },
    after: v.value,
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Saved." };
}

async function insertNetwork(
  current: CurrentUser,
  clinic: ClinicRow,
  label: string,
  cidr: string,
  via: "manual" | "captured",
): Promise<AdminTcResult> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("location_network")
    .select("id, is_active")
    .eq("location_id", clinic.id)
    .eq("cidr", cidr)
    .maybeSingle();
  if (existing?.is_active) return { ok: false, error: `${cidr} is already approved for this clinic.` };
  if (existing) {
    const { error } = await admin.from("location_network").update({ is_active: true, label }).eq("id", existing.id);
    if (error) return { ok: false, error: `Could not save: ${error.message}` };
    await audit(current, "timeclock.network_reactivated", "location_network", existing.id as string, `Re-approved ${cidr} for ${clinicName(clinic)}`, {
      location_id: clinic.id,
      cidr,
      label,
    });
  } else {
    const { data, error } = await admin
      .from("location_network")
      .insert({ location_id: clinic.id, label, cidr, added_by: current.appUser.id, added_via: via })
      .select("id")
      .single();
    if (error) return { ok: false, error: `Could not save: ${error.message}` };
    await audit(
      current,
      via === "captured" ? "timeclock.network_captured" : "timeclock.network_added",
      "location_network",
      data.id as string,
      `Approved ${cidr} (${label}) for ${clinicName(clinic)}`,
      { location_id: clinic.id, cidr, label, added_via: via },
    );
  }
  revalidatePath(PAGE);
  return { ok: true, message: `${cidr} approved for ${clinicName(clinic)}.` };
}

export async function addClinicNetwork(formData: FormData): Promise<AdminTcResult> {
  const gate = await editorGate();
  if (!gate.ok) return gate;
  const clinic = await loadClinic(String(formData.get("location_id") ?? ""));
  if (!clinic) return { ok: false, error: "Unknown location." };
  const label = String(formData.get("label") ?? "").trim().slice(0, 100);
  if (!label) return { ok: false, error: 'Give the network a label (e.g. "Venice staff Wi-Fi").' };
  const v = validateClinicNetwork(String(formData.get("cidr") ?? ""));
  if (!v.ok) return v;
  return insertNetwork(gate.current, clinic, label, v.cidr, "manual");
}

/** "Approve the network I'm on now": the public IP this request came from. */
export async function captureCurrentNetwork(locationId: string, label: string): Promise<AdminTcResult> {
  const gate = await editorGate();
  if (!gate.ok) return gate;
  const clinic = await loadClinic(locationId);
  if (!clinic) return { ok: false, error: "Unknown location." };
  const name = (label ?? "").trim().slice(0, 100) || "Captured on site";
  const ip = parseIp((await requestMeta()).ip);
  if (!ip) return { ok: false, error: "Couldn't read your network address. Enter the IP manually." };
  if (!isPublicIp(ip)) {
    return {
      ok: false,
      error: `Your connection shows an internal address (${formatIp(ip)}), which can't be approved. Enter the clinic's public IP manually.`,
    };
  }
  return insertNetwork(gate.current, clinic, name, hostCidr(ip), "captured");
}

export async function setNetworkActive(networkId: string, active: boolean): Promise<AdminTcResult> {
  const gate = await editorGate();
  if (!gate.ok) return gate;
  if (!UUID.test(networkId)) return { ok: false, error: "Unknown network." };
  const admin = createAdminClient();
  const { data: net } = await admin
    .from("location_network")
    .select("id, location_id, cidr, label, is_active")
    .eq("id", networkId)
    .maybeSingle();
  if (!net) return { ok: false, error: "Unknown network." };
  if (net.is_active === active) return { ok: true, message: "No change." };
  const { error } = await admin.from("location_network").update({ is_active: active }).eq("id", networkId);
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  await audit(
    gate.current,
    active ? "timeclock.network_reactivated" : "timeclock.network_deactivated",
    "location_network",
    networkId,
    `${active ? "Re-approved" : "Removed"} ${String(net.cidr)} (${net.label})`,
    { location_id: net.location_id, cidr: String(net.cidr) },
  );
  revalidatePath(PAGE);
  return { ok: true, message: active ? "Re-approved." : "Removed (kept in history)." };
}

export type TestFromHereResult =
  | {
      ok: true;
      ip: string | null;
      ipIsPublic: boolean;
      gps: { latitude: number; longitude: number; accuracy: number | null } | null;
      overall: LocationCheck;
      clinics: ClinicDiagnosis[];
    }
  | { ok: false; error: string };

/** What a punch from this device would get — nothing is recorded. */
export async function testFromHere(input: {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  scheduledLocationId?: string | null;
}): Promise<TestFromHereResult> {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canAccessModule(current.appUser, "admin")) return { ok: false, error: "Admin access required." };
  const fin = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const lat = fin(input?.latitude, -90, 90);
  const lng = fin(input?.longitude, -180, 180);
  const gps = lat !== null && lng !== null ? { latitude: lat, longitude: lng, accuracy: fin(input?.accuracy, 0, 100_000) } : null;
  const parsed = parseIp((await requestMeta()).ip);
  const ip = parsed ? formatIp(parsed) : null;
  const evidence = { ip, latitude: gps?.latitude ?? null, longitude: gps?.longitude ?? null, accuracy: gps?.accuracy ?? null };
  const locations = await getClockLocations();
  const scheduled =
    input?.scheduledLocationId && UUID.test(input.scheduledLocationId) ? input.scheduledLocationId : null;
  return {
    ok: true,
    ip,
    ipIsPublic: parsed ? isPublicIp(parsed) : false,
    gps,
    overall: evaluateLocation(locations, scheduled, evidence),
    clinics: diagnoseAll(locations, evidence),
  };
}
