import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { getTimeClockAdminData } from "@/lib/timeclock/admin";
import { Panel } from "../_components";
import { ClinicCard } from "./clinic-card";
import { TestFromHere } from "./test-from-here";

export const dynamic = "force-dynamic";

export default async function AdminTimeClockPage() {
  // The Admin layout already requires Admin access (Owner/Admin edit, Executive view).
  const current = await getCurrentUser({ allowPreview: true });
  const canEdit = !!current && isAdminRole(current.appUser.role) && !current.viewAs;
  const clinics = await getTimeClockAdminData();
  const mapsKey = process.env.GOOGLE_MAPS_PUBLIC_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

  return (
    <div className="space-y-6">
      <Panel
        title="How the time-clock location check works"
        description="A punch passes when the device is on one of the clinic's approved networks OR its GPS is inside the clinic's geofence (per the clinic's policy). A failed check never blocks a punch: the employee confirms “Working off-site” with a note and it goes to Scheduling ▸ Time Clock for approval. A clinic with nothing set up records punches without checking them."
      >
        <TestFromHere clinics={clinics.filter((c) => c.clock_policy !== "anywhere_logged").map((c) => ({ id: c.id, name: c.name }))} />
      </Panel>
      {clinics.map((c) => (
        <ClinicCard key={c.id} clinic={c} canEdit={canEdit} mapsKey={mapsKey} />
      ))}
      <p className="text-xs text-slate-400">
        Add or edit clinic addresses under Admin ▸ Locations. Every change here is recorded in the audit log.
      </p>
    </div>
  );
}
