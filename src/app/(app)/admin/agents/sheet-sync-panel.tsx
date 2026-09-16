"use client";

import { useState, useTransition } from "react";
import { Panel } from "../_components";
import {
  SHEET_ISSUE_LABELS,
  SHEET_ISSUE_TONE,
  type SheetSyncIssue,
  type SheetSyncSource,
} from "@/lib/admin/sheet-sync";
import { setSheetSyncIssueStatus } from "./actions";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-300",
  skipped: "bg-slate-500/10 text-slate-300",
  error: "bg-rose-500/10 text-rose-300",
};

function SourceRow({ source }: { source: SheetSyncSource }) {
  const summary = source.last_summary ?? {};
  const counts = ["parsed", "inserted", "updated", "issues"]
    .filter((k) => typeof summary[k] === "number")
    .map((k) => `${summary[k]} ${k}`)
    .join(" · ");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 py-2 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {source.spreadsheet_url ? (
            <a
              href={source.spreadsheet_url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium text-sky-300 hover:underline"
            >
              {source.name}
            </a>
          ) : (
            <span className="truncate text-sm font-medium text-slate-200">{source.name}</span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              STATUS_STYLE[source.last_status ?? ""] ?? "bg-slate-500/10 text-slate-400"
            }`}
          >
            {source.last_status ?? "never run"}
          </span>
        </div>
        <p className="truncate text-xs text-slate-400">
          Last checked {when(source.last_synced_at)}
          {counts ? ` — ${counts}` : ""}
        </p>
        {source.last_error && (
          <p className="truncate text-xs text-rose-300">{source.last_error}</p>
        )}
      </div>
      <span className="text-xs text-slate-500">
        sheet edited {when(source.last_modified_time)}
      </span>
    </div>
  );
}

function IssueRow({ issue }: { issue: SheetSyncIssue }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tone = SHEET_ISSUE_TONE[issue.kind] ?? "warn";
  const hint = typeof issue.detail?.hint === "string" ? issue.detail.hint : null;

  const act = (status: "resolved" | "ignored") => {
    setError(null);
    startTransition(async () => {
      const res = await setSheetSyncIssueStatus(issue.id, status);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <tr className="border-b border-slate-800 last:border-0 align-top">
      <td className="py-2 pr-3">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            tone === "danger" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"
          }`}
        >
          {SHEET_ISSUE_LABELS[issue.kind] ?? issue.kind}
        </span>
      </td>
      <td className="py-2 pr-3 text-sm text-slate-200">{issue.subject}</td>
      <td className="py-2 pr-3 text-xs text-slate-400">
        {hint}
        {error && <span className="block text-rose-300">{error}</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-slate-500">{when(issue.first_seen_at)}</td>
      <td className="py-2 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => act("resolved")}
          disabled={pending}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Fixed
        </button>
        <button
          type="button"
          onClick={() => act("ignored")}
          disabled={pending}
          className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50"
          title="Never raise this again — for permanent exceptions."
        >
          Always ignore
        </button>
      </td>
    </tr>
  );
}

export function SheetSyncPanel({
  sources,
  issues,
}: {
  sources: SheetSyncSource[];
  issues: SheetSyncIssue[];
}) {
  if (!sources.length) return null;

  return (
    <Panel
      title="Connected spreadsheets"
      description="Pulled every morning. Safe changes are applied automatically; anything ambiguous lands in the review queue below."
    >
      <div className="mb-4">
        {sources.map((s) => (
          <SourceRow key={s.id} source={s} />
        ))}
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Needs review ({issues.length})
      </p>
      {issues.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing outstanding — the last run applied every change it found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <tbody>
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
