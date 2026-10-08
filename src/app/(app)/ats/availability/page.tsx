import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { loadInterviewer } from "@/lib/ats/booking";
import { googleRedirectUri, isGoogleCalendarConfigured } from "@/lib/ats/google-calendar";
import { AvailabilityEditor } from "./availability-editor";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { google, reason } = await searchParams;
  const canEdit = canEditModule(current.appUser, "ats");
  const schedule = await loadInterviewer(current.authId);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ats" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to recruiting
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">My Availability</h1>
      <p className="mt-1 text-sm text-slate-500">
        When candidates can book interviews with you. Ops checks your Google Calendar for busy times — it never
        imports your events.
      </p>

      {google === "connected" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✅ Google Calendar connected.</p>
      )}
      {google === "error" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t connect Google Calendar{reason ? `: ${reason}` : "."}
        </p>
      )}
      {google === "not_configured" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Google Calendar sign-in isn&apos;t set up for Ops yet. An admin needs to add the OAuth client (see the
          recruiting workflow doc).
        </p>
      )}

      {!canEdit || !schedule ? (
        <p className="mt-6 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Only people who can edit Recruiting can take interview bookings.
        </p>
      ) : (
        <AvailabilityEditor
          schedule={{
            timezone: schedule.timezone,
            windows: schedule.windows,
            default_duration: schedule.default_duration,
            buffer_minutes: schedule.buffer_minutes,
            min_notice_hours: schedule.min_notice_hours,
            is_active: schedule.is_active || schedule.windows.length === 0,
            google_email: schedule.google_email,
            google_connected: schedule.google_connected,
          }}
          googleConfigured={isGoogleCalendarConfigured()}
          redirectUri={googleRedirectUri()}
        />
      )}
    </div>
  );
}
