"use client";

import { DownloadIcon, PrinterIcon } from "lucide-react";
import type { SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Submit / approve / publish / reopen, plus the print and export controls once published. */
export function WorkflowButtons({
  status,
  onStatus,
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
}: {
  status: SchedWeek["status"];
  onStatus: (s: SchedWeek["status"]) => void;
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button className="bg-amber-500 text-white hover:bg-amber-600" onClick={() => onStatus("pending_approval")}>
          Submit for approval
        </Button>
      )}
      {status === "pending_approval" && (
        <>
          <Button className="bg-sky-600 text-white hover:bg-sky-700" onClick={() => onStatus("approved")}>
            Approve
          </Button>
          <Button variant="outline" onClick={() => onStatus("draft")}>
            Send back
          </Button>
        </>
      )}
      {status === "approved" && (
        <>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onStatus("published")}>
            Publish
          </Button>
          <Button variant="outline" onClick={() => onStatus("draft")}>
            Reopen
          </Button>
        </>
      )}
      {status === "published" && (
        <>
          <Tooltip>
            <TooltipTrigger render={<Button onClick={onPrintGrid} />}>
              <PrinterIcon /> Print Grid
            </TooltipTrigger>
            <TooltipContent>Print the schedule grid exactly as shown</TooltipContent>
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
            <TooltipTrigger render={<Button variant="outline" onClick={onExportCsv} />}>
              <DownloadIcon /> CSV for When I Work
            </TooltipTrigger>
            <TooltipContent>
              Download a CSV grouped by Location then Employee — matching how you enter shifts into When I Work
              (pick a location, then work employee-by-employee)
            </TooltipContent>
          </Tooltip>
          <Button variant="outline" onClick={() => onStatus("draft")}>
            Reopen
          </Button>
        </>
      )}
    </div>
  );
}
