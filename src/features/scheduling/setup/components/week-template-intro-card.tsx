"use client";

import { btnPrimary } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";

/** What the Week Template tab shows before any template exists (or is open). */
export function WeekTemplateIntroCard({
  pending,
  canEdit,
  onCreate,
}: {
  pending: boolean;
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-800">
        Week Templates
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Build reusable copies of a full weekly schedule — shift lines with
        employees assigned to each shift — and keep as many as you need, for
        example a standard week, a short-staffed week, and a summer
        rotation. From the Grid tab you can apply any of them to any week.
      </p>
      <button
        disabled={pending || !canEdit}
        onClick={onCreate}
        className={`${btnPrimary} mt-4`}
      >
        {pending ? "Creating…" : "Create your first template"}
      </button>
    </Card>
  );
}
