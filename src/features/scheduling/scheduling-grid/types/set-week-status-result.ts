import type { ActionResult } from "@/features/scheduling/shared/types/action-result";

/** A publish that needs confirmation: shifts without start/end times. */
export type SetWeekStatusResult =
  | ActionResult
  | { ok: false; error: string; untimed: string[] };
