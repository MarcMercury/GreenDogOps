"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { reviewOffsitePunch } from "@/features/scheduling/time-clock/actions/offsite-actions";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastResult } from "@/features/scheduling/shared/lib/action-toast";

type Decision = "approved" | "rejected";

/** Approve / reject one off-site punch (a note is required to reject). */
export function OffsiteDecision({ punchId }: { punchId: string }) {
  const router = useRouter();
  const form = useAppForm({
    defaultValues: { note: "" },
    // The two buttons share the form; which one was pressed arrives as meta.
    onSubmitMeta: { decision: "approved" as Decision },
    onSubmit: async ({ value, meta }) => {
      const res = toastResult(await reviewOffsitePunch(punchId, meta.decision, value.note.trim()), (r) => r.message);
      if (res.ok) router.refresh();
    },
  });
  return (
    <div className="space-y-2">
      <form.AppField name="note">
        {(field) => <field.TextField label="Note" maxLength={1000} placeholder="Note (required to reject)" />}
      </form.AppField>
      <form.Subscribe selector={(s) => ({ note: s.values.note, isSubmitting: s.isSubmitting })}>
        {({ note, isSubmitting }) => (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting}
              onClick={() => void form.handleSubmit({ decision: "approved" })}
            >
              Approve
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={isSubmitting || note.trim().length === 0}
                    onClick={() => void form.handleSubmit({ decision: "rejected" })}
                  />
                }
              >
                Reject
              </TooltipTrigger>
              <TooltipContent>Rejecting removes the punch from the timecard</TooltipContent>
            </Tooltip>
          </div>
        )}
      </form.Subscribe>
    </div>
  );
}
