import type { SchedWeek } from "@/lib/schedule/types";

/**
 * Open the requested template, falling back to the first so the tab shows a
 * grid rather than an empty chooser.
 */
export function selectTemplateId(
  templates: Pick<SchedWeek, "id">[],
  templateParam: string | undefined,
): string | null {
  return (
    (templateParam && templates.some((t) => t.id === templateParam)
      ? templateParam
      : templates[0]?.id) ?? null
  );
}
