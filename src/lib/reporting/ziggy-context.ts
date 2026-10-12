import type { createAdminClient } from "../supabase/admin";
import { addDays, todayInWorkTz } from "../worklist/dates";

// ---------------------------------------------------------------------------
// "About the person asking" for Ask Ziggy.
//
// Questions like "when am I working next?" or "how much PTO do I have left?"
// are answered from the asker's OWN records, fetched here by their person_id
// with the service-role client. The model never gets SQL access to other
// employees' HR rows for this: General-tier users cannot query person,
// person_employment or person_time_off at all, and this block contains only
// the asker. Pay and benefit figures are deliberately left out.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** How far ahead to list published shifts and approved time off. */
const SHIFT_DAYS_AHEAD = 21;
/** How far back to list time-off requests (so "was my PTO approved?" works). */
const TIME_OFF_DAYS_BACK = 60;

export interface AskerShift {
  date: string;
  location: string | null;
  label: string | null;
  start: string | null;
  end: string | null;
  attendance: string | null;
}

export interface AskerTimeOff {
  kind: string;
  status: string;
  start: string;
  end: string;
}

export interface AskerFacts {
  name: string;
  email: string | null;
  role: string;
  today: string;
  /** null when the login is not linked to a roster record. */
  employee: {
    status: string | null;
    jobTitle: string | null;
    homeLocation: string | null;
    hireDate: string | null;
    ptoAllotment: number | null;
    ptoUsed: number | null;
    ptoAvailable: number | null;
    ptoHoursThisYear: number | null;
    shifts: AskerShift[];
    timeOff: AskerTimeOff[];
  } | null;
}

function hhmm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

/** Plain-text block for the prompt. Pure, so the content rules are testable. */
export function formatAskerContext(facts: AskerFacts): string {
  const lines = [`- Name: ${facts.name}${facts.email ? ` (${facts.email})` : ""}`, `- Green Dog Ops role: ${facts.role}`];
  const e = facts.employee;
  if (!e) {
    lines.push("- This login is not linked to an employee record, so no schedule, time off or PTO is on file for them.");
    return lines.join("\n");
  }
  if (e.jobTitle) lines.push(`- Job title: ${e.jobTitle}`);
  if (e.homeLocation) lines.push(`- Home location: ${e.homeLocation}`);
  if (e.status) lines.push(`- Employment status: ${e.status}`);
  if (e.hireDate) lines.push(`- Hire date: ${e.hireDate}`);

  const pto = [
    e.ptoAllotment !== null ? `allotment ${e.ptoAllotment}` : null,
    e.ptoUsed !== null ? `used ${e.ptoUsed}` : null,
    e.ptoAvailable !== null ? `available ${e.ptoAvailable}` : null,
  ].filter(Boolean);
  lines.push(
    pto.length
      ? `- PTO balance on the HR roster: ${pto.join(", ")} (units as entered by HR)`
      : "- PTO balance: not recorded on the HR roster",
  );
  if (e.ptoHoursThisYear !== null) {
    lines.push(`- Itemised PTO logged this calendar year: ${e.ptoHoursThisYear} hours`);
  }

  if (e.shifts.length) {
    lines.push(`- Published shifts from ${facts.today} (next ${SHIFT_DAYS_AHEAD} days):`);
    for (const s of e.shifts) {
      const time = s.start && s.end ? `${hhmm(s.start)}–${hhmm(s.end)}` : null;
      const parts = [s.location, s.label, time].filter(Boolean).join(", ");
      const attendance = s.attendance && s.attendance !== "scheduled" ? ` [${s.attendance}]` : "";
      lines.push(`  - ${s.date}: ${parts || "shift"}${attendance}`);
    }
  } else {
    lines.push(`- Published shifts: none in the next ${SHIFT_DAYS_AHEAD} days (draft schedules are not shown).`);
  }

  if (e.timeOff.length) {
    lines.push("- Time-off requests (recent and upcoming):");
    for (const t of e.timeOff) {
      const span = t.start === t.end ? t.start : `${t.start} to ${t.end}`;
      lines.push(`  - ${span}: ${t.kind}, ${t.status}`);
    }
  } else {
    lines.push("- Time-off requests: none recent or upcoming.");
  }
  return lines.join("\n");
}

/**
 * Fetch the asker's own facts. Every query is keyed on their person_id; a
 * failure in one source degrades to "not recorded" rather than failing the
 * question.
 */
export async function getAskerFacts(
  admin: AdminClient,
  user: { full_name: string | null; role: string; person_id: string | null },
  email: string | null,
): Promise<AskerFacts> {
  const today = todayInWorkTz();
  const base = { name: user.full_name?.trim() || email || "Unknown user", email, role: user.role, today };
  if (!user.person_id) return { ...base, employee: null };
  const personId = user.person_id;

  const until = addDays(today, SHIFT_DAYS_AHEAD);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [person, employment, assignments, timeOff, ptoDays] = await Promise.all([
    admin.from("person").select("full_name, preferred_name, status").eq("id", personId).maybeSingle(),
    // Non-compensation columns only — pay and benefits never enter the prompt.
    admin
      .from("person_employment")
      .select("hire_date, location_id, position_id, pto_allotment, pto_used, pto_available")
      .eq("person_id", personId)
      .maybeSingle(),
    admin
      .from("sched_assignment")
      .select("work_date, week_id, line_id, location_id, attendance_status, removed_post_publish")
      .eq("person_id", personId)
      .gte("work_date", today)
      .lte("work_date", until)
      .order("work_date"),
    admin
      .from("person_time_off")
      .select("kind, status, start_date, end_date")
      .eq("person_id", personId)
      .gte("end_date", addDays(today, -TIME_OFF_DAYS_BACK))
      .order("start_date"),
    admin.from("person_pto_day").select("hours").eq("person_id", personId).gte("pto_date", yearStart),
  ]);

  const emp = employment.data as {
    hire_date: string | null;
    location_id: string | null;
    position_id: string | null;
    pto_allotment: number | null;
    pto_used: number | null;
    pto_available: number | null;
  } | null;

  type Assignment = {
    work_date: string;
    week_id: string;
    line_id: string | null;
    location_id: string | null;
    attendance_status: string | null;
    removed_post_publish: boolean | null;
  };
  const rawShifts = ((assignments.data ?? []) as Assignment[]).filter((a) => !a.removed_post_publish);

  const weekIds = [...new Set(rawShifts.map((a) => a.week_id))];
  const lineIds = [...new Set(rawShifts.map((a) => a.line_id).filter((v): v is string => !!v))];
  const locationIds = [
    ...new Set(
      [...rawShifts.map((a) => a.location_id), emp?.location_id ?? null].filter((v): v is string => !!v),
    ),
  ];

  const [weeks, lines, locations, position] = await Promise.all([
    weekIds.length
      ? admin.from("sched_week").select("id, status").in("id", weekIds)
      : Promise.resolve({ data: [] }),
    lineIds.length
      ? admin.from("sched_week_line").select("id, label, start_time, end_time").in("id", lineIds)
      : Promise.resolve({ data: [] }),
    locationIds.length
      ? admin.from("location").select("id, name").in("id", locationIds)
      : Promise.resolve({ data: [] }),
    emp?.position_id
      ? admin.from("position").select("title").eq("id", emp.position_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Only published weeks: a draft schedule is not a commitment to the employee.
  const published = new Set(
    ((weeks.data ?? []) as { id: string; status: string }[]).filter((w) => w.status === "published").map((w) => w.id),
  );
  const lineById = new Map(
    ((lines.data ?? []) as { id: string; label: string | null; start_time: string | null; end_time: string | null }[]).map(
      (l) => [l.id, l],
    ),
  );
  const locationById = new Map(((locations.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));

  const shifts: AskerShift[] = rawShifts
    .filter((a) => published.has(a.week_id))
    .map((a) => {
      const line = a.line_id ? lineById.get(a.line_id) : undefined;
      return {
        date: a.work_date,
        location: a.location_id ? (locationById.get(a.location_id) ?? null) : null,
        label: line?.label ?? null,
        start: line?.start_time ?? null,
        end: line?.end_time ?? null,
        attendance: a.attendance_status,
      };
    });

  const p = person.data as { full_name: string | null; preferred_name: string | null; status: string | null } | null;
  const ptoRows = (ptoDays.data ?? []) as { hours: number | null }[];

  return {
    ...base,
    name: p?.preferred_name?.trim() || p?.full_name?.trim() || base.name,
    employee: {
      status: p?.status ?? null,
      jobTitle: (position.data as { title: string | null } | null)?.title ?? null,
      homeLocation: emp?.location_id ? (locationById.get(emp.location_id) ?? null) : null,
      hireDate: emp?.hire_date ?? null,
      ptoAllotment: emp?.pto_allotment ?? null,
      ptoUsed: emp?.pto_used ?? null,
      ptoAvailable: emp?.pto_available ?? null,
      ptoHoursThisYear: ptoDays.error ? null : ptoRows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0),
      shifts,
      timeOff: ((timeOff.data ?? []) as { kind: string; status: string; start_date: string; end_date: string }[]).map(
        (t) => ({ kind: t.kind, status: t.status, start: t.start_date, end: t.end_date }),
      ),
    },
  };
}
