"use client";

import { DAY_LABELS, gridName } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";

/** Approve / deny a PTO request from the grid's time-off section. */
export function PtoDecisionMenu({
  chip,
  day,
  onClose,
  onDecide,
}: {
  chip: PtoChip;
  day: number;
  onClose: () => void;
  onDecide: (status: "approved" | "denied") => void | Promise<unknown>;
}) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  const range =
    chip.startDate === chip.endDate
      ? fmt(chip.startDate)
      : `${fmt(chip.startDate)} – ${fmt(chip.endDate)}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{gridName(chip.person)}</DialogTitle>
          <DialogDescription>
            Time-off request · {range} ·{" "}
            <span className={`font-medium ${chip.status === "approved" ? "text-emerald-600" : "text-amber-600"}`}>
              {chip.status === "approved" ? "Approved" : "Pending"}
            </span>
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Affects the whole request ({range}), not just {DAY_LABELS[day]}.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Denying removes the time off and frees {gridName(chip.person)} to be scheduled those days.
        </p>
        <DialogFooter>
          <Button variant="destructive" onClick={() => void onDecide("denied")}>
            Deny
          </Button>
          <Button
            disabled={chip.status === "approved"}
            onClick={() => void onDecide("approved")}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
