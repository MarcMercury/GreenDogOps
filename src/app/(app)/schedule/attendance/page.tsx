import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canReviewTimeClock } from "@/lib/auth/permissions";
import { PageHeader } from "../../_components/ui";
import { getAttendanceData } from "../data";
import {
  effectiveAttendance,
  gridName,
  reliabilityScore,
  type AttendanceStatus,
  type ReliabilityTally,
} from "@/lib/schedule/types";
import { AttendanceTable, type EmployeeAttendance } from "./attendance-table";
import { DailyView } from "./daily-view";

export const dynamic = "force-dynamic";

function emptyTally(): ReliabilityTally {
  return {
    total: 0,
    present: 0,
    late: 0,
    late_excused: 0,
    absent: 0,
    absent_excused: 0,
    no_show: 0,
    pto: 0,
    scheduled: 0,
  };
}

function ViewTabs({ view, showDaily }: { view: "reliability" | "day"; showDaily: boolean }) {
  const tab = (key: "reliability" | "day", href: string, label: string) => (
    <Link
      href={href}
      aria-current={view === key ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        view === key ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Attendance view">
      {tab("reliability", "/schedule/attendance", "Reliability by employee")}
      {showDaily ? tab("day", "/schedule/attendance?view=day", "Daily — live from the time clock") : null}
    </nav>
  );
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { view: viewParam, date } = await searchParams;
  const current = await getCurrentUser({ allowPreview: true });
  const showDaily = !!current && canReviewTimeClock(current.appUser);
  const view = viewParam === "day" && showDaily ? "day" : "reliability";

  if (view === "day") {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Scheduling"
          title="Attendance"
          description="Each published shift graded live from the time clock. A manager's attendance mark always wins."
        />
        <ViewTabs view={view} showDaily={showDaily} />
        <DailyView dateParam={date} />
      </div>
    );
  }

  const { rows, system } = await getAttendanceData();

  // Roll up per employee.
  const byPerson = new Map<string, EmployeeAttendance>();
  for (const row of rows) {
    if (!row.person) continue;
    const id = row.person.id;
    if (!byPerson.has(id)) {
      byPerson.set(id, {
        personId: id,
        name: gridName(row.person),
        tally: emptyTally(),
        score: null,
      });
    }
    const entry = byPerson.get(id)!;
    const status = effectiveAttendance(
      row.assignment,
      row.published,
      undefined,
      system[row.assignment.id],
    ) as AttendanceStatus;
    entry.tally[status] += 1;
    if (status !== "scheduled") entry.tally.total += 1;
  }

  const employees = [...byPerson.values()]
    .map((e) => ({ ...e, score: reliabilityScore(e.tally) }))
    .sort((a, b) => {
      // Resolved employees first, then by score ascending (most at-risk first).
      if (a.score == null && b.score == null) return a.name.localeCompare(b.name);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return a.score - b.score;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Attendance"
        description="Reliability is rolled up from attendance on published schedules: manager marks (including auto-absences), and — once time-clock attendance is turned on in Admin ▸ Settings — the time clock for unmarked shifts."
      />
      <ViewTabs view={view} showDaily={showDaily} />
      <AttendanceTable employees={employees} />
    </div>
  );
}
