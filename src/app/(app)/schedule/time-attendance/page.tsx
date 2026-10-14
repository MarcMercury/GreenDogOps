import { redirect } from "next/navigation";

/** Merged into Scheduling ▸ Attendance ("Daily" view). Kept so old links still work. */
export default async function TimeAndAttendanceRedirect({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(`/schedule/attendance?view=day${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `&date=${date}` : ""}`);
}
