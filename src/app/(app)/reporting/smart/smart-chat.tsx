"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { askSmartQuestion } from "./actions";
import type { SmartResult, SmartRow, SmartTurn } from "@/lib/reporting/smart";

const SUGGESTIONS = [
  "What is the average age of a patient in our system?",
  "How many clients have the last name Smith?",
  "How much revenue did we generate in July?",
  "Top 10 revenue-producing doctors this year",
  "How many active patients do we have by species?",
  "Which location had the most appointments last month?",
];

type Message =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; result?: SmartResult };

/** Minimal markdown: **bold**, `code`, and "- " bullet lists. */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-slate-100 px-1 py-0.5 text-[12px] text-slate-700">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function AnswerText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flush(`ul-${i}`);
    if (trimmed) blocks.push(<p key={`p-${i}`}>{renderInline(trimmed)}</p>);
  });
  flush("ul-end");

  return <div className="space-y-2 text-sm leading-relaxed text-slate-700">{blocks}</div>;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    // Numeric columns arrive as strings from Postgres numeric/bigint.
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
      }
    }
    return value;
  }
  return JSON.stringify(value);
}

function toCsv(columns: string[], rows: SmartRow[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

function ResultTable({ result }: { result: SmartResult }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? result.rows : result.rows.slice(0, 12);
  if (!result.rows.length || !result.columns.length) return null;

  const download = () => {
    const blob = new Blob([toCsv(result.columns, result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "smart-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // A single value is already stated in the answer — no table needed.
  if (result.rows.length === 1 && result.columns.length === 1) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {result.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50/70">
                {result.columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
        <span>
          {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? "" : "s"}
          {result.truncated ? " (capped)" : ""}
          {result.rows.length > 12 && !expanded ? " — showing first 12" : ""}
        </span>
        <span className="flex gap-3">
          {result.rows.length > 12 ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="font-medium text-emerald-700 hover:underline">
              {expanded ? "Show less" : "Show all"}
            </button>
          ) : null}
          <button type="button" onClick={download} className="font-medium text-emerald-700 hover:underline">
            Download CSV
          </button>
        </span>
      </div>
    </div>
  );
}

function SqlDetails({ result }: { result: SmartResult }) {
  const [open, setOpen] = useState(false);
  if (!result.sql) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium uppercase tracking-wide text-slate-400 hover:text-slate-600"
      >
        {open ? "Hide" : "Show"} query{result.provider ? ` · ${result.provider}` : ""}
      </button>
      {open ? (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {result.sql}
        </pre>
      ) : null}
    </div>
  );
}

export function SmartChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;

    const history: SmartTurn[] = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", content: q }]);
    setInput("");
    setPending(true);
    try {
      const result = await askSmartQuestion(q, history);
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-a`, role: "assistant", content: result.answer, result },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-e`,
          role: "assistant",
          content: e instanceof Error ? e.message : "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="min-h-[22rem] space-y-4 p-5">
          {!messages.length ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-50/70 p-4 text-sm text-emerald-900">
                Ask a question about anything in Green Dog Ops — patients, clients, invoices,
                appointments, staff or the schedule. I&apos;ll query the live database and answer.
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Try one of these
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2 text-sm text-white shadow-sm">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start">
                <div className="w-full max-w-[95%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <AnswerText text={m.content} />
                  {m.result ? (
                    <>
                      <ResultTable result={m.result} />
                      <SqlDetails result={m.result} />
                    </>
                  ) : null}
                </div>
              </div>
            ),
          )}

          {pending ? (
            <div className="flex justify-start">
              <p className="rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-400">
                Working on it — reading the data…
              </p>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="flex items-end gap-2 border-t border-slate-100 p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder="Ask a question — e.g. how much revenue did we generate in July?"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Asking…" : "Ask"}
          </button>
          {messages.length ? (
            <button
              type="button"
              onClick={() => setMessages([])}
              disabled={pending}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
        </form>
      </div>
      <p className="text-xs text-slate-400">
        Answers are generated by AI from a read-only query of your live database. Open “Show query”
        to check the SQL behind any answer before relying on it.
      </p>
    </div>
  );
}
