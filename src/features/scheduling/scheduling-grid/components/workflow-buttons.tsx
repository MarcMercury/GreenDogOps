"use client";

import type { SchedWeek } from "@/lib/schedule/types";

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
  const btn =
    "rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <button
          onClick={() => onStatus("pending_approval")}
          className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
        >
          Submit for approval
        </button>
      )}
      {status === "pending_approval" && (
        <>
          <button
            onClick={() => onStatus("approved")}
            className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}
          >
            Approve
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Send back
          </button>
        </>
      )}
      {status === "approved" && (
        <>
          <button
            onClick={() => onStatus("published")}
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            Publish
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Reopen
          </button>
        </>
      )}
      {status === "published" && (
        <>
          <button
            onClick={onPrintGrid}
            className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}
            title="Print the schedule grid exactly as shown"
          >
            Print Grid
          </button>
          <button
            onClick={onPrintEmployee}
            className={`${btn} bg-slate-700 text-white hover:bg-slate-800`}
            title="Print one page per employee listing all of their shifts (optimized for entering into When I Work)"
          >
            Export Per Employee
          </button>
          <button
            onClick={onExportCsv}
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            title="Download a CSV grouped by Location then Employee — matching how you enter shifts into When I Work (pick a location, then work employee-by-employee)"
          >
            CSV for When I Work
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Reopen
          </button>
        </>
      )}
    </div>
  );
}
