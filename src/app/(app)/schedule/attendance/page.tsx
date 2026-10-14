import { PageHeader } from "../../_components/ui";
import { AttendanceTable } from "@/features/scheduling/attendance/components/attendance-table";
import { getAttendanceData } from "@/features/scheduling/attendance/db/get-attendance-data";
import { rollupAttendanceByEmployee } from "@/features/scheduling/attendance/lib/rollup";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const { rows, system } = await getAttendanceData();
  const employees = rollupAttendanceByEmployee(rows, system);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Attendance & Reliability"
        description="Reliability is rolled up from attendance on published schedules: manager marks (including auto-absences), and — once time-clock attendance is turned on in Admin ▸ Settings — the time clock for unmarked shifts."
      />
      <AttendanceTable employees={employees} />
    </div>
  );
}
