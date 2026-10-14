import type { SchedWeek } from "@/lib/schedule/types";

/** Which name the Week Template tab is asking for. */
export type TemplatePrompt =
  | { kind: "create" }
  | { kind: "rename"; template: SchedWeek }
  | { kind: "duplicate"; template: SchedWeek };
