"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReminderView } from "@/lib/worklist/reminders";
import { describeSchedule } from "@/lib/worklist/reminders";
import { relativeDayLabel } from "@/lib/worklist/dates";
import { isSlackLink } from "@/lib/worklist/items";
import { setReminderDone } from "./actions";

function ReminderLink({ href }: { href: string | null }) {
  if (!href) return null;
  return isSlackLink(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-violet-700 hover:underline">
      Slack ↗
    </a>
  ) : (
    <Link href={href} className="text-xs font-medium text-emerald-700 hover:underline">
      Open →
    </Link>
  );
}

function ReminderRow({ view, today }: { view: ReminderView; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = view.status === "done";

  return (
    <li className={`flex items-start gap-3 px-4 py-2.5 ${pending ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={done}
        disabled={pending || !view.occurrence}
        aria-label={`Mark "${view.rule.title}" ${done ? "not done" : "done"}`}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const res = await setReminderDone(view.rule.id, view.occurrence!, e.target.checked);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? "text-slate-400 line-through" : "font-medium text-slate-800"}`}>
          {view.rule.title}
        </p>
        <p className="text-xs text-slate-500">
          {view.status === "overdue" && view.occurrence ? (
            <span className="font-semibold text-amber-600">Since {relativeDayLabel(view.occurrence, today).toLowerCase()} · </span>
          ) : null}
          {describeSchedule(view.rule)}
          {view.rule.owner_user_id ? " · personal" : ""}
        </p>
        {view.rule.details && !done ? <p className="mt-0.5 text-xs text-slate-400">{view.rule.details}</p> : null}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
      <ReminderLink href={view.rule.href} />
    </li>
  );
}

export function RemindersPanel({
  current,
  upcoming,
  today,
}: {
  current: ReminderView[];
  upcoming: { view: ReminderView; date: string }[];
  today: string;
}) {
  const open = current.filter((v) => v.status !== "done").length;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Reminders {open > 0 ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{open}</span> : null}
          </h2>
          <p className="text-xs text-slate-500">Recurring things to check today.</p>
        </div>
        <Link href="/reminders" className="text-xs font-medium text-emerald-700 hover:underline">
          Manage
        </Link>
      </header>
      {current.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-slate-400">No reminders due today.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {current.map((v) => (
            <ReminderRow key={v.rule.id} view={v} today={today} />
          ))}
        </ul>
      )}
      {upcoming.length > 0 ? (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Coming up</p>
          <ul className="space-y-0.5">
            {upcoming.slice(0, 6).map(({ view, date }) => (
              <li key={`${view.rule.id}:${date}`} className="flex justify-between gap-2 text-xs text-slate-500">
                <span className="truncate">{view.rule.title}</span>
                <span className="shrink-0 text-slate-400">{relativeDayLabel(date, today)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
