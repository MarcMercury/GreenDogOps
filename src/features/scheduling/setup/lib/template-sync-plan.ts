import type { SchedShiftTemplate, SchedWeekLine } from "@/lib/schedule/types";

/** A shift line to add to the template week, copied from a shift template. */
export interface TemplateWeekLineInsert {
  week_id: string;
  template_id: string;
  department_id: string;
  role_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
}

/** The template-derived fields a drifted line is re-synced to. */
export type TemplateWeekLinePatch = Omit<TemplateWeekLineInsert, "week_id" | "template_id">;

export interface TemplateWeekSyncPlan {
  toInsert: TemplateWeekLineInsert[];
  toUpdate: { id: string; patch: TemplateWeekLinePatch }[];
  toRemove: string[];
}

/**
 * Work out how to make a template week's shift lines mirror the Dept/Shift
 * Template exactly: lines to insert for new template rows, drifted lines to
 * re-sync (department, role, label, times, order), and every line that no
 * longer has a live template behind it — inactive templates, inactive
 * departments, duplicates, and ad-hoc lines added straight onto the template
 * grid. `templateDrift` counts the same three buckets for the banner.
 */
export function planTemplateWeekSync(
  weekId: string,
  lines: SchedWeekLine[],
  activeTemplates: SchedShiftTemplate[],
  activeDeptIds: Set<string>,
): TemplateWeekSyncPlan {
  const templates = activeTemplates.filter((t) => activeDeptIds.has(t.department_id));

  // First line per template wins; everything else is surplus.
  const lineByTemplate = new Map<string, SchedWeekLine>();
  const surplus: string[] = [];
  for (const l of lines) {
    if (l.template_id && !lineByTemplate.has(l.template_id))
      lineByTemplate.set(l.template_id, l);
    else surplus.push(l.id);
  }

  const toInsert: TemplateWeekLineInsert[] = [];
  const toUpdate: { id: string; patch: TemplateWeekLinePatch }[] = [];
  for (const [i, t] of templates.entries()) {
    const existing = lineByTemplate.get(t.id);
    if (!existing) {
      toInsert.push({
        week_id: weekId,
        template_id: t.id,
        department_id: t.department_id,
        role_id: t.role_id,
        label: t.label,
        start_time: t.start_time,
        end_time: t.end_time,
        sort_order: t.sort_order ?? i,
      });
      continue;
    }
    lineByTemplate.delete(t.id);
    const patch: TemplateWeekLinePatch = {
      department_id: t.department_id,
      role_id: t.role_id,
      label: t.label,
      start_time: t.start_time,
      end_time: t.end_time,
      sort_order: t.sort_order ?? i,
    };
    const drifted = (Object.keys(patch) as (keyof typeof patch)[]).some(
      (k) => (existing[k as keyof SchedWeekLine] ?? null) !== (patch[k] ?? null),
    );
    if (drifted) toUpdate.push({ id: existing.id, patch });
  }
  // Whatever is left was backed by a template that is gone or deactivated.
  const toRemove = [...surplus, ...[...lineByTemplate.values()].map((l) => l.id)];

  return { toInsert, toUpdate, toRemove };
}
