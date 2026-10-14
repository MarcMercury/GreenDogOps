import type { ReliabilityTally } from "@/lib/schedule/types";

/** A zeroed tally to count resolved shifts into. */
export function emptyTally(): ReliabilityTally {
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
