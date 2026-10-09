"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkItem } from "@/lib/worklist/items";
import { groupWorkItems, type WorkBucket } from "@/lib/worklist/items";
import { relativeDayLabel } from "@/lib/worklist/dates";
import { MODULE_ICONS, MODULE_LABELS, isModuleKey } from "@/lib/shared/module-icons";
import { createTaskAction, setTaskStatusAction } from "./actions";

const BUCKET_TONE: Record<WorkBucket, string> = {
  overdue: "text-rose-600",
  today: "text-emerald-700",
  week: "text-slate-500",
  later: "text-slate-400",
  anytime: "text-slate-400",
};

const PRIORITY_DOT: Record<WorkItem["priority"], string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-500",
  normal: "bg-slate-300",
  low: "bg-slate-200",
};

function ActionLink({ item }: { item: WorkItem }) {
  if (!item.href) return null;
  if (item.target === "slack") {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
      >
        Open in Slack ↗
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
    >
      Open →
    </Link>
  );
}

function WorkRow({ item, today }: { item: WorkItem; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const icon = isModuleKey(item.module) ? MODULE_ICONS[item.module] : item.target === "slack" ? "💬" : "📌";
  const overdue = item.due !== null && item.due < today;

  const setStatus = (status: "done" | "dismissed") =>
    start(async () => {
      setError(null);
      const res = await setTaskStatusAction(item.taskId!, status);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${pending ? "opacity-50" : ""}`}>
      {item.taskId ? (
        <button
          type="button"
          aria-label={`Mark "${item.title}" done`}
          title="Mark done"
          disabled={pending}
          onClick={() => setStatus("done")}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-[10px] text-transparent transition hover:border-emerald-500 hover:text-emerald-500"
        >
          ✓
        </button>
      ) : (
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sm"
          title={isModuleKey(item.module) ? MODULE_LABELS[item.module] : undefined}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[item.priority]}`} title={`${item.priority} priority`} />
          <span className="min-w-0">{item.title}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {item.due ? (
            <span className={overdue ? "font-semibold text-rose-600" : ""}>
              {relativeDayLabel(item.due, today)}
              {item.dueTime ? ` · ${item.dueTime}` : ""}
            </span>
          ) : null}
          {isModuleKey(item.module) && item.taskId ? (
            <span>
              {MODULE_ICONS[item.module]} {MODULE_LABELS[item.module]}
            </span>
          ) : null}
          {item.detail ? <span className="truncate">{item.detail}</span> : null}
          {item.meta ? <span className="italic text-slate-400">{item.meta}</span> : null}
        </p>
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ActionLink item={item} />
        {item.taskId ? (
          <button
            type="button"
            title="Dismiss"
            aria-label={`Dismiss "${item.title}"`}
            disabled={pending}
            onClick={() => setStatus("dismissed")}
            className="rounded-md px-1.5 py-1 text-xs text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        ) : null}
      </div>
    </li>
  );
}

function AddTaskForm({
  meId,
  assignees,
  slackConnected,
  onDone,
}: {
  meId: string;
  assignees: { id: string; name: string }[];
  slackConnected: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(meId);
  const forOther = assignee !== meId;

  return (
    <form
      className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3"
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await createTaskAction(fd);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          onDone();
          router.refresh();
        })
      }
    >
      <input
        name="title"
        required
        maxLength={200}
        autoFocus
        placeholder="What needs to be done?"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
      />
      <textarea
        name="details"
        maxLength={4000}
        rows={2}
        placeholder="Details (optional)"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {assignees.length > 0 ? (
          <label className="flex items-center gap-1 text-slate-500">
            For
            <select
              name="assignee_user_id"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              <option value={meId}>Me</option>
              {assignees
                .filter((a) => a.id !== meId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1 text-slate-500">
          Due
          <input type="date" name="due_date" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          Priority
          <select name="priority" defaultValue="normal" className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <input
          name="link"
          maxLength={1000}
          placeholder="Link: /schedule or a Slack link"
          className="min-w-[12rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
        />
      </div>
      {forOther ? (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" name="notify_slack" defaultChecked />
          Also send them a Slack DM{slackConnected ? "" : " (if their Slack is connected)"}
        </label>
      ) : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add task"}
        </button>
      </div>
    </form>
  );
}

export function WorkList({
  items,
  today,
  meId,
  assignees,
  slackConnected,
  canAddTasks,
}: {
  items: WorkItem[];
  today: string;
  meId: string;
  assignees: { id: string; name: string }[];
  slackConnected: boolean;
  canAddTasks: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "ops" | "slack" | "tasks">("all");
  const filtered = useMemo(
    () =>
      items.filter((i) =>
        filter === "all" ? true : filter === "tasks" ? !!i.taskId : i.target === filter,
      ),
    [items, filter],
  );
  const groups = useMemo(() => groupWorkItems(filtered, today), [filtered, today]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">My work</h2>
          <p className="text-xs text-slate-500">Tasks assigned to you and items waiting on you across Ops.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {(
              [
                ["all", "All"],
                ["tasks", "Tasks"],
                ["ops", "In Ops"],
                ["slack", "In Slack"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-2 py-1 font-medium transition ${
                  filter === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {canAddTasks ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              + Add task
            </button>
          ) : null}
        </div>
      </header>

      {adding ? (
        <AddTaskForm meId={meId} assignees={assignees} slackConnected={slackConnected} onDone={() => setAdding(false)} />
      ) : null}

      {groups.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-2xl">🎉</p>
          <p className="mt-1 text-sm font-medium text-slate-700">Nothing waiting on you.</p>
          <p className="text-xs text-slate-400">New assignments, approvals and Slack-created tasks will show up here.</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.bucket}>
            <h3
              className={`border-b border-slate-50 bg-slate-50/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${BUCKET_TONE[g.bucket]}`}
            >
              {g.label} <span className="font-normal text-slate-400">· {g.items.length}</span>
            </h3>
            <ul className="divide-y divide-slate-50">
              {g.items.map((item) => (
                <WorkRow key={item.id} item={item} today={today} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
