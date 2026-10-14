"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { reopenPayPeriod } from "@/features/scheduling/payroll/actions/period-actions";
import { reopenReasonSchema } from "@/features/scheduling/payroll/schema/pay-period.schema";
import { PromptDialog, type PromptValues } from "@/features/scheduling/shared/components/prompt-dialog";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";

const validator = formValidator<PromptValues>(reopenReasonSchema);

/** Reopen a locked period (Owner/Admin). Asks for the reason that goes into the audit log. */
export function ReopenButton({ period }: { period: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Reopen
      </Button>
      <PromptDialog
        open={open}
        onOpenChange={setOpen}
        title="Reopen pay period"
        description="Why are you reopening this pay period? Approvals stay; the reason is recorded in the audit log."
        label="Reason (recorded in the audit log)"
        placeholder="e.g. a missed punch was found after locking"
        submitLabel="Reopen"
        validator={validator}
        onSubmit={(reason) => reopenPayPeriod(period, reason)}
        success={(r) => r.message}
      />
    </>
  );
}
