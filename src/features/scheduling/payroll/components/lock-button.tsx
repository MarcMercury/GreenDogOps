"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { lockPayPeriod } from "@/features/scheduling/payroll/actions/period-actions";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";

/** Lock the open period. Disabled, with the reasons as its tooltip, while anything still blocks the lock. */
export function LockButton({ period, blockers }: { period: string; blockers: string[] }) {
  const button = (
    <ActionButton
      action={() => lockPayPeriod(period)}
      success={(r) => r.message}
      disabled={blockers.length > 0}
      confirm={{
        title: "Lock this pay period?",
        description: "Approvals become final and no timecard changes can be added for these dates.",
        confirmLabel: "Lock period",
      }}
    >
      Lock period
    </ActionButton>
  );
  if (blockers.length === 0) return button;
  // A disabled button swallows pointer events, so the reasons hang off a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipContent>{blockers.join(" ")}</TooltipContent>
    </Tooltip>
  );
}
