import { getCurrentUser } from "@/lib/auth/session";
import { canReviewTimeClock } from "@/lib/auth/permissions";
import { todayInWorkTz } from "@/lib/worklist/dates";
import { RestrictedNotice } from "@/features/scheduling/shared/components/restricted-notice";
import { getDayAttendance } from "@/features/scheduling/time-attendance/db/get-day-attendance";
import { groupByLocation } from "@/features/scheduling/time-attendance/lib/group-by-location";
import { resolveDate } from "@/features/scheduling/time-attendance/lib/resolve-date";
import { dateParamSchema } from "@/features/scheduling/time-attendance/schema/date-param.schema";
import { AttendanceModeBanner } from "@/features/scheduling/time-attendance/components/attendance-mode-banner";
import { DateNav } from "@/features/scheduling/time-attendance/components/date-nav";
import { LocationDaySection } from "@/features/scheduling/time-attendance/components/location-day-section";
import { NoShiftsNotice } from "@/features/scheduling/time-attendance/components/no-shifts-notice";
import { UnscheduledWork } from "@/features/scheduling/time-attendance/components/unscheduled-work";
import { PageHeader } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function TimeAndAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canReviewTimeClock(current.appUser)) {
    return (
      <RestrictedNotice>
        Time &amp; Attendance is for timecard approvers (Owner, Admin, Executive, HR / Manager) and Schedule Admins.
      </RestrictedNotice>
    );
  }

  // A `?date=` that fails the shape check counts as absent: the page opens on
  // today rather than erroring on a stale link.
  const params = dateParamSchema.safeParse(await searchParams);
  const today = todayInWorkTz();
  const date = resolveDate(params.success ? params.data.date : undefined, today);
  const { settings, graded, unscheduled } = await getDayAttendance(date);
  const locations = groupByLocation(graded);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Time & Attendance"
        description="Published shifts graded from the time clock, live. A manager's attendance mark always wins."
      />

      <DateNav date={date} today={today} />

      <AttendanceModeBanner settings={settings} />

      {locations.length === 0 ? <NoShiftsNotice date={date} /> : null}

      {locations.map((group) => (
        <LocationDaySection key={group.id} group={group} />
      ))}

      {unscheduled.length > 0 ? <UnscheduledWork date={date} items={unscheduled} /> : null}
    </div>
  );
}
