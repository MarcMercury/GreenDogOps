import type { ReliabilityTally } from "@/lib/schedule/types";

/** The per-status columns of the Attendance & Reliability table, in display order. */
export const COLUMNS: {
  key: keyof ReliabilityTally;
  label: string;
  tone: string;
}[] = [
  { key: "present", label: "Present", tone: "text-emerald-600" },
  { key: "late", label: "Late", tone: "text-amber-600" },
  { key: "late_excused", label: "Late (Exc)", tone: "text-amber-500" },
  { key: "absent", label: "Absent", tone: "text-red-600" },
  { key: "absent_excused", label: "Absent (Exc)", tone: "text-orange-500" },
  { key: "no_show", label: "No Show", tone: "text-red-700" },
  { key: "pto", label: "PTO", tone: "text-violet-600" },
];
