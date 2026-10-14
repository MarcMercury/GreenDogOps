"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { decideCorrection } from "@/features/scheduling/time-clock/actions/correction-actions";
import type { CorrectionTarget } from "@/features/scheduling/time-clock/types/correction-target";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastResult } from "@/features/scheduling/shared/lib/action-toast";

type Decision = "approved" | "denied";

/** Approve / deny one correction request (a note is required to deny). */
export function CorrectionDecision({
  requestId,
  needsTarget,
  targets,
}: {
  requestId: string;
  /** "Wrong time" requests replace one of the day's punches. */
  needsTarget: boolean;
  targets: CorrectionTarget[];
}) {
  const router = useRouter();
  const form = useAppForm({
    // A single candidate punch is pre-selected; otherwise the approver picks.
    defaultValues: { note: "", replaceTarget: targets.length === 1 ? targets[0].value : "" },
    // The two buttons share the form; which one was pressed arrives as meta.
    onSubmitMeta: { decision: "approved" as Decision },
    onSubmit: async ({ value, meta }) => {
      const res = toastResult(
        await decideCorrection(
          requestId,
          meta.decision,
          value.note.trim(),
          meta.decision === "approved" && needsTarget ? value.replaceTarget || null : null,
        ),
        (r) => r.message,
      );
      if (res.ok) router.refresh();
    },
  });
  return (
    <div className="space-y-2">
      {needsTarget ? (
        <form.AppField name="replaceTarget">
          {(field) => (
            <field.NativeSelectField label="Punch to replace" options={targets} placeholder="Replace which punch?" />
          )}
        </form.AppField>
      ) : null}
      <form.AppField name="note">
        {(field) => (
          <field.TextField label="Note" maxLength={1000} placeholder="Note to the employee (required to deny)" />
        )}
      </form.AppField>
      <form.Subscribe
        selector={(s) => ({ note: s.values.note, target: s.values.replaceTarget, isSubmitting: s.isSubmitting })}
      >
        {({ note, target, isSubmitting }) => (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || (needsTarget && !target)}
              onClick={() => void form.handleSubmit({ decision: "approved" })}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isSubmitting || note.trim().length === 0}
              onClick={() => void form.handleSubmit({ decision: "denied" })}
            >
              Deny
            </Button>
          </div>
        )}
      </form.Subscribe>
    </div>
  );
}
