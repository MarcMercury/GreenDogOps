import type { SchedWeekLine } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";

export interface TemplateDrift {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * How far the Week Template's shift lines have drifted from the Dept/Shift
 * Template. Mirrors `syncTemplateWeekFromShiftTemplates` (see
 * `planTemplateWeekSync`) so the banner counts match what the button will
 * actually do.
 */
export function templateDrift(
  data: Pick<SetupData, "departments" | "templates">,
  lines: SchedWeekLine[],
): TemplateDrift {
  const activeDepts = new Set(
    data.departments.filter((d) => d.is_active).map((d) => d.id),
  );
  const templates = data.templates.filter(
    (t) => t.is_active && activeDepts.has(t.department_id),
  );

  const lineByTemplate = new Map<string, SchedWeekLine>();
  let removed = 0;
  for (const l of lines) {
    if (l.template_id && !lineByTemplate.has(l.template_id))
      lineByTemplate.set(l.template_id, l);
    else removed++;
  }

  let added = 0;
  let updated = 0;
  for (const t of templates) {
    const line = lineByTemplate.get(t.id);
    if (!line) {
      added++;
      continue;
    }
    lineByTemplate.delete(t.id);
    if (
      line.department_id !== t.department_id ||
      (line.role_id ?? null) !== (t.role_id ?? null) ||
      (line.label ?? null) !== (t.label ?? null) ||
      (line.start_time ?? null) !== (t.start_time ?? null) ||
      (line.end_time ?? null) !== (t.end_time ?? null) ||
      line.sort_order !== t.sort_order
    )
      updated++;
  }
  removed += lineByTemplate.size;

  return { added, updated, removed, total: added + updated + removed };
}
