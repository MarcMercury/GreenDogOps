"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, ROLE_LABELS, MODULES } from "@/lib/auth/permissions";
import {
  describeSchedule,
  ordinal,
  type ReminderCadence,
  type ReminderRule,
} from "@/lib/worklist/reminders";
import { deleteReminder, saveMyReminder, saveSharedReminder } from "./actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CADENCE_LABELS: Record<ReminderCadence, string> = {
  weekly: "Weekly (pick days)",
  monthly_day: "Monthly on a date",
  monthly_business_day: "Monthly on a business day",
  monthly_weekday: "Monthly on a weekday (e.g. last Friday)",
  yearly: "Yearly",
};

const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none";
const small = "rounded-md border border-slate-200 px-2 py-1 text-sm";

export function ReminderForm({
  shared,
  rule,
  onDone,
}: {
  shared: boolean;
  rule?: ReminderRule;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<ReminderCadence>(rule?.cadence ?? "weekly");
  const [days, setDays] = useState<number[]>(rule?.weekdays?.length ? rule.weekdays : [1]);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          setError(null);
          if (cadence === "weekly") {
            fd.delete("weekdays");
            for (const d of days) fd.append("weekdays", String(d));
          }
          const res = shared ? await saveSharedReminder(fd) : await saveMyReminder(fd);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          onDone?.();
          router.refresh();
        })
      }
    >
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <input name="title" required maxLength={200} defaultValue={rule?.title} placeholder="Reminder" className={input} />
      <textarea
        name="details"
        rows={2}
        maxLength={2000}
        defaultValue={rule?.details ?? ""}
        placeholder="What to check (optional)"
        className={input}
      />
      <input
        name="link"
        maxLength={1000}
        defaultValue={rule?.href ?? ""}
        placeholder="Link: an Ops page like /schedule, or a Slack link (optional)"
        className={input}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          name="cadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as ReminderCadence)}
          className={small}
        >
          {(Object.keys(CADENCE_LABELS) as ReminderCadence[]).map((c) => (
            <option key={c} value={c}>
              {CADENCE_LABELS[c]}
            </option>
          ))}
        </select>

        {cadence === "weekly" ? (
          <div className="flex flex-wrap items-center gap-1">
            {DAYS.map((label, d) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  days.includes(d) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setDays([1, 2, 3, 4, 5])} className="ml-1 text-xs text-emerald-700 hover:underline">
              Weekdays
            </button>
            <button type="button" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} className="text-xs text-emerald-700 hover:underline">
              Every day
            </button>
          </div>
        ) : null}

        {cadence === "monthly_day" ? (
          <select name="month_day" defaultValue={rule?.month_day ?? 1} className={small}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
              </option>
            ))}
            <option value={-1}>Last day</option>
          </select>
        ) : null}

        {cadence === "monthly_business_day" ? (
          <select name="month_day" defaultValue={rule?.month_day ?? 1} className={small}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)} business day
              </option>
            ))}
            <option value={-1}>Last business day</option>
          </select>
        ) : null}

        {cadence === "monthly_weekday" ? (
          <>
            <select name="week_of_month" defaultValue={rule?.week_of_month ?? 1} className={small}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {ordinal(n)}
                </option>
              ))}
              <option value={-1}>Last</option>
            </select>
            <select name="weekdays" defaultValue={rule?.weekdays?.[0] ?? 5} className={small}>
              {DAY_NAMES.map((name, d) => (
                <option key={name} value={d}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-slate-500">of the month</span>
          </>
        ) : null}

        {cadence === "yearly" ? (
          <>
            <select name="month" defaultValue={rule?.month ?? 1} className={small}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select name="month_day" defaultValue={rule?.month_day ?? 1} className={small}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value={-1}>Last day</option>
            </select>
          </>
        ) : null}
      </div>

      {shared ? (
        <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">Who gets it (none checked = every role)</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {APP_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1 text-xs text-slate-700">
                  <input type="checkbox" name="audience_roles" value={r} defaultChecked={rule?.audience_roles.includes(r)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Only people who can open
            <select name="module" defaultValue={rule?.module ?? ""} className={small}>
              <option value="">(any module)</option>
              {MODULES.filter((m) => m.key !== "dashboard" && m.key !== "crm_business").map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Order
            <input type="number" name="sort_order" min={0} max={10000} defaultValue={rule?.sort_order ?? 100} className={`${small} w-20`} />
          </label>
        </div>
      ) : null}

      {rule ? (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" name="is_active" defaultChecked={rule.is_active} /> Active
        </label>
      ) : null}

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        {onDone ? (
          <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : rule ? "Save" : "Add reminder"}
        </button>
      </div>
    </form>
  );
}

/** A list of reminder rules; editable ones get Edit/Delete. */
export function ReminderList({
  rules,
  shared,
  canEdit,
  empty,
}: {
  rules: ReminderRule[];
  shared: boolean;
  canEdit: boolean;
  empty: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {canEdit ? (
        adding ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3">
            <ReminderForm shared={shared} onDone={() => setAdding(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            + New reminder
          </button>
        )
      ) : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {rules.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.id} className={`px-4 py-3 ${pending ? "opacity-60" : ""}`}>
              {editing === r.id ? (
                <ReminderForm shared={shared} rule={r} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${r.is_active ? "text-slate-900" : "text-slate-400 line-through"}`}>{r.title}</p>
                    <p className="text-xs text-slate-500">
                      {describeSchedule(r)}
                      {shared
                        ? ` · ${r.audience_roles.length ? r.audience_roles.map((x) => ROLE_LABELS[x as keyof typeof ROLE_LABELS] ?? x).join(", ") : "Everyone"}`
                        : ""}
                      {shared && r.module ? ` · needs ${MODULES.find((m) => m.key === r.module)?.label ?? r.module}` : ""}
                      {r.href ? ` · ${r.href}` : ""}
                    </p>
                    {r.details ? <p className="text-xs text-slate-400">{r.details}</p> : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-2 text-xs">
                      <button type="button" onClick={() => setEditing(r.id)} className="text-emerald-700 hover:underline">
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirm(`Delete "${r.title}"?`)) return;
                          start(async () => {
                            setError(null);
                            const res = await deleteReminder(r.id);
                            if (!res.ok) setError(res.error);
                            router.refresh();
                          });
                        }}
                        className="text-rose-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
