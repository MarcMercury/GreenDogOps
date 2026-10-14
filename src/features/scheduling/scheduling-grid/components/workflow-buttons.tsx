"use client";

import { CheckIcon, DownloadIcon, PrinterIcon, RocketIcon, SendIcon, Undo2Icon } from "lucide-react";
import type { SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The page's primary action colour (the mock's navy). */
const PRIMARY = "bg-slate-900 text-white hover:bg-slate-800";

/**
 * Submit / approve / publish / reopen, plus the print and export controls
 * once published. Transitions need edit rights; printing and exporting a
 * published week do not.
 */
export function WorkflowButtons({
  status,
  canEdit,
  onStatus,
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
}: {
  status: SchedWeek["status"];
  canEdit: boolean;
  onStatus: (s: SchedWeek["status"]) => void;
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && status === "draft" && (
        <Button className={PRIMARY} onClick={() => onStatus("pending_approval")}>
          <SendIcon /> Submit for approval
        </Button>
      )}
      {canEdit && status === "pending_approval" && (
        <>
          <Button variant="outline" onClick={() => onStatus("draft")}>
            <Undo2Icon /> Send back
          </Button>
          <Button className={PRIMARY} onClick={() => onStatus("approved")}>
            <CheckIcon /> Approve
          </Button>
        </>
      )}
      {canEdit && status === "approved" && (
        <>
          <Button variant="outline" onClick={() => onStatus("draft")}>
            <Undo2Icon /> Reopen
          </Button>
          <Button className={PRIMARY} onClick={() => onStatus("published")}>
            <RocketIcon /> Publish
          </Button>
        </>
      )}
      {status === "published" && (
        <>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" onClick={onExportCsv} />}>
              <DownloadIcon /> CSV for When I Work
            </TooltipTrigger>
            <TooltipContent>
              Download a CSV grouped by Location then Employee — matching how you enter shifts into When I Work
              (pick a location, then work employee-by-employee)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="secondary" onClick={onPrintEmployee} />}>
              <PrinterIcon /> Export Per Employee
            </TooltipTrigger>
            <TooltipContent>
              Print one page per employee listing all of their shifts (optimized for entering into When I Work)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button className={PRIMARY} onClick={onPrintGrid} />}>
              <PrinterIcon /> Print Grid
            </TooltipTrigger>
            <TooltipContent>Print the schedule grid exactly as shown</TooltipContent>
          </Tooltip>
          {canEdit && (
            <Button variant="outline" onClick={() => onStatus("draft")}>
              <Undo2Icon /> Reopen
            </Button>
          )}
        </>
      )}
    </div>
  );
}
