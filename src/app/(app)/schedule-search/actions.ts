"use server";

import { requireUser } from "@/lib/auth/session";
import { searchShifts, type ShiftHit } from "./data";

export interface ScheduleSearchInput {
  personIds: string[];
  startDate: string;
  endDate: string;
}

/** Server action backing the Schedule Search page. */
export async function runScheduleSearch(
  input: ScheduleSearchInput,
): Promise<ShiftHit[]> {
  await requireUser();
  const ids = Array.isArray(input.personIds)
    ? [...new Set(input.personIds.filter((v) => typeof v === "string" && v))]
    : [];
  return searchShifts(ids, input.startDate, input.endDate);
}
