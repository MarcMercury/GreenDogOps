"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { approveTimecard, unapproveTimecard } from "@/features/scheduling/payroll/actions/timecard-actions";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";

/** Approve one employee's timecard, or withdraw the approval, while the period is open. */
export function ApproveButton({
  period,
  personId,
  approved,
  disabled,
  title,
}: {
  period: string;
  personId: string;
  approved: boolean;
  disabled?: boolean;
  /** Why the button is disabled (own timecard, blockers); shown as a tooltip. */
  title?: string;
}) {
  const button = (
    <ActionButton
      action={() => (approved ? unapproveTimecard(period, personId) : approveTimecard(period, personId))}
      success={(r) => r.message}
      variant={approved ? "outline" : "default"}
      size="xs"
      disabled={disabled}
    >
      {approved ? "Un-approve" : "Approve"}
    </ActionButton>
  );
  if (!title) return button;
  // A disabled button swallows pointer events, so the hint hangs off a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
