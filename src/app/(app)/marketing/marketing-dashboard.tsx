"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "../_components/ui";
import {
  type MarketingGoal,
  type MarketingInitiative,
  type MarketingEvent,
  type MarketingBudgetPeriod,
  type MarketingBudgetEntry,
  type MarketingResource,
  type MarketingTreeNode,
  type MarketingEventSource,
  type MarketingEventAttendee,
  type InitiativeLink,
  INITIATIVE_CATEGORIES,
  INITIATIVE_STATUSES,
  PRIORITIES,
  BUDGET_ENTRY_STATUSES,
  RESOURCE_CATEGORIES,
  MARKETING_CHANNELS,
  initiativeCategoryLabel,
  initiativeStatusLabel,
  priorityLabel,
  eventStatusLabel,
  resourceCategoryLabel,
} from "@/lib/marketing/types";
import { MarketingTree } from "./marketing-tree";
import { EventsTab } from "./marketing-events";
import {
  saveGoal,
  deleteGoal,
  saveInitiative,
  updateInitiativeStatus,
  deleteInitiative,
  saveBudgetPeriod,
  saveBudgetEntry,
  deleteBudgetEntry,
  saveResource,
  deleteResource,
  type ActionResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Shared styles + helpers
// ---------------------------------------------------------------------------
const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, string> = {
  idea: "bg-slate-100 text-slate-600",
  planned: "bg-sky-50 text-sky-700",
  in_progress: "bg-amber-50 text-amber-700",
  blocked: "bg-red-50 text-red-700",
  done: "bg-emerald-50 text-emerald-700",
  researching: "bg-slate-100 text-slate-600",
  tentative: "bg-sky-50 text-sky-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  completed: "bg-indigo-50 text-indigo-700",
  cancelled: "bg-red-50 text-red-700",
  paid: "bg-emerald-50 text-emerald-700",
  reimbursed: "bg-indigo-50 text-indigo-700",
};
const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-500",
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className ?? "bg-slate-100 text-slate-600"}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function OptionsSelect({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select name={name} defaultValue={defaultValue} className={fieldInput}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ===========================================================================
// Dashboard
// ===========================================================================
type TabKey = "tree" | "initiatives" | "events" | "activity" | "budget" | "channels" | "resources";
const BASE_TABS: { key: TabKey; label: string; icon: string; adminOnly?: boolean }[] = [
  { key: "tree", label: "Marketing Tree", icon: "🌳" },
  { key: "initiatives", label: "Initiatives", icon: "🗂️" },
  { key: "events", label: "Events", icon: "🎪" },
  { key: "activity", label: "Activity", icon: "📈" },
  { key: "budget", label: "Budget", icon: "💵", adminOnly: true },
  { key: "channels", label: "Channels", icon: "🔗" },
  { key: "resources", label: "Resources", icon: "🧰" },
];

export function MarketingDashboard({
  canEdit,
  isAdmin,
  goals,
  initiatives,
  events,
  budgetPeriods,
  budgetEntries,
  resources,
  treeNodes,
  eventSources,
  eventAttendees,
}: {
  canEdit: boolean;
  isAdmin: boolean;
  goals: MarketingGoal[];
  initiatives: MarketingInitiative[];
  events: MarketingEvent[];
  budgetPeriods: MarketingBudgetPeriod[];
  budgetEntries: MarketingBudgetEntry[];
  resources: MarketingResource[];
  treeNodes: MarketingTreeNode[];
  eventSources: MarketingEventSource[];
  eventAttendees: MarketingEventAttendee[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("tree");
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const tabs = useMemo(
    () => BASE_TABS.filter((t) => !t.adminOnly || isAdmin),
    [isAdmin],
  );

  // Budget-category goals are sensitive; only admins see them in the KPI strip.
  const visibleGoals = useMemo(
    () => (isAdmin ? goals : goals.filter((g) => (g.category ?? "").toLowerCase() !== "budget")),
    [goals, isAdmin],
  );

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Marketing Management"
        description="The single source of truth for marketing activity — goals, initiatives, events, budget and the tools & partners we coordinate with."
      />

      <GoalStrip canEdit={canEdit} goals={visibleGoals} run={run} />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="mr-1.5" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tree" && <MarketingTree canEdit={canEdit} nodes={treeNodes} />}
      {tab === "initiatives" && (
        <InitiativesTab canEdit={canEdit} initiatives={initiatives} run={run} />
      )}
      {tab === "events" && (
        <EventsTab
          canEdit={canEdit}
          events={events}
          sources={eventSources}
          attendees={eventAttendees}
        />
      )}
      {tab === "activity" && (
        <ActivityTab
          initiatives={initiatives}
          events={events}
          treeNodes={treeNodes}
        />
      )}
      {tab === "budget" && isAdmin && (
        <BudgetTab
          canEdit={canEdit}
          periods={budgetPeriods}
          entries={budgetEntries}
          run={run}
        />
      )}
      {tab === "channels" && <ChannelsTab />}
      {tab === "resources" && (
        <ResourcesTab canEdit={canEdit} resources={resources} run={run} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

type Run = (action: () => Promise<ActionResult>, after?: () => void) => void;

// ---------------------------------------------------------------------------
// Goals / KPI strip
// ---------------------------------------------------------------------------
function GoalStrip({
  canEdit,
  goals,
  run,
}: {
  canEdit: boolean;
  goals: MarketingGoal[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingGoal | "new" | null>(null);
  const active = goals.filter((g) => g.is_active);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Core goals & KPIs
        </h2>
        {canEdit && (
          <button type="button" className={btnGhost} onClick={() => setEditing("new")}>
            + Goal
          </button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-sm text-slate-400">
          No goals yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {active.map((g) => {
            const pct =
              g.target_value && g.target_value > 0
                ? Math.min(100, Math.round(((g.current_value ?? 0) / g.target_value) * 100))
                : null;
            const isMoney = (g.metric_unit ?? "").trim() === "$";
            const fmt = isMoney ? fmtMoney : fmtNum;
            return (
              <button
                key={g.id}
                type="button"
                disabled={!canEdit}
                onClick={() => canEdit && setEditing(g)}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition enabled:hover:border-emerald-300 enabled:hover:shadow"
              >
                <p className="text-xs font-medium text-slate-500">{g.title}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {fmt(g.current_value ?? 0)}
                  {g.target_value != null && (
                    <span className="text-sm font-medium text-slate-400">
                      {" "}
                      / {fmt(g.target_value)}
                    </span>
                  )}
                </p>
                {pct != null && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {[g.period, g.category].filter(Boolean).join(" · ") || "\u00A0"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <GoalDialog
          goal={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </section>
  );
}

function GoalDialog({
  goal,
  onClose,
  run,
}: {
  goal: MarketingGoal | null;
  onClose: () => void;
  run: Run;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveGoal(fd), onClose);
  }
  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {goal && <input type="hidden" name="id" value={goal.id} />}
        <div>
          <label className={fieldLabel}>Title</label>
          <input name="title" defaultValue={goal?.title ?? ""} required className={fieldInput} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Current value</label>
            <input name="current_value" defaultValue={goal?.current_value ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Target value</label>
            <input name="target_value" defaultValue={goal?.target_value ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Unit (e.g. clients, $, leads)</label>
            <input name="metric_unit" defaultValue={goal?.metric_unit ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Period (e.g. 2026, Monthly)</label>
            <input name="period" defaultValue={goal?.period ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Category</label>
            <input name="category" defaultValue={goal?.category ?? ""} className={fieldInput} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Notes</label>
          <textarea name="notes" defaultValue={goal?.notes ?? ""} rows={2} className={fieldInput} />
        </div>
        <DialogFooter
          onClose={onClose}
          onDelete={goal ? () => run(() => deleteGoal(goal.id), onClose) : undefined}
          deleteLabel="Delete goal"
        />
      </form>
    </Modal>
  );
}

function DialogFooter({
  onClose,
  onDelete,
  deleteLabel = "Delete",
}: {
  onClose: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 pt-4">
      <div>
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this item? This cannot be undone.")) onDelete();
            }}
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            {deleteLabel}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary}>
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initiatives tab
// ---------------------------------------------------------------------------
function InitiativesTab({
  canEdit,
  initiatives,
  run,
}: {
  canEdit: boolean;
  initiatives: MarketingInitiative[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingInitiative | "new" | null>(null);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(
    () =>
      initiatives.filter(
        (i) =>
          (!category || i.category === category) &&
          (!status || i.status === status),
      ),
    [initiatives, category, status],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All categories</option>
          {INITIATIVE_CATEGORIES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All statuses</option>
          {INITIATIVE_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-sm text-slate-400">{filtered.length} shown</span>
        <div className="ml-auto">
          {canEdit && (
            <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
              + Initiative
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyRow label="No initiatives match." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Initiative</th>
                <th className="px-4 py-2.5 font-semibold">Owner</th>
                <th className="px-4 py-2.5 font-semibold">3rd party</th>
                <th className="px-4 py-2.5 font-semibold">Next action</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  className="cursor-pointer transition hover:bg-slate-50"
                  onClick={() => canEdit && setEditing(i)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{i.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge>{initiativeCategoryLabel(i.category)}</Badge>
                      <Badge className={PRIORITY_COLORS[i.priority]}>
                        {priorityLabel(i.priority)}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{i.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{i.partner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{i.next_action ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(i.due_date)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {canEdit ? (
                      <select
                        value={i.status}
                        onChange={(e) => run(() => updateInitiativeStatus(i.id, e.target.value))}
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_COLORS[i.status] ?? ""}`}
                      >
                        {INITIATIVE_STATUSES.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge className={STATUS_COLORS[i.status]}>
                        {initiativeStatusLabel(i.status)}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <InitiativeDialog
          initiative={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </section>
  );
}

function InitiativeDialog({
  initiative,
  onClose,
  run,
}: {
  initiative: MarketingInitiative | null;
  onClose: () => void;
  run: Run;
}) {
  const [links, setLinks] = useState<InitiativeLink[]>(initiative?.links ?? []);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveInitiative(fd), onClose);
  }
  return (
    <Modal title={initiative ? "Edit initiative" : "New initiative"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {initiative && <input type="hidden" name="id" value={initiative.id} />}
        <div>
          <label className={fieldLabel}>Title</label>
          <input name="title" defaultValue={initiative?.title ?? ""} required className={fieldInput} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={fieldLabel}>Category</label>
            <OptionsSelect name="category" defaultValue={initiative?.category ?? "other"} options={INITIATIVE_CATEGORIES} />
          </div>
          <div>
            <label className={fieldLabel}>Status</label>
            <OptionsSelect name="status" defaultValue={initiative?.status ?? "planned"} options={INITIATIVE_STATUSES} />
          </div>
          <div>
            <label className={fieldLabel}>Priority</label>
            <OptionsSelect name="priority" defaultValue={initiative?.priority ?? "medium"} options={PRIORITIES} />
          </div>
          <div>
            <label className={fieldLabel}>Owner</label>
            <input name="owner_name" defaultValue={initiative?.owner_name ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>3rd-party partner</label>
            <input name="partner_name" defaultValue={initiative?.partner_name ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Due date</label>
            <input type="date" name="due_date" defaultValue={initiative?.due_date ?? ""} className={fieldInput} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Next action</label>
          <input name="next_action" defaultValue={initiative?.next_action ?? ""} className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>Notes</label>
          <textarea name="notes" defaultValue={initiative?.notes ?? ""} rows={3} className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>Links</label>
          <div className="space-y-2">
            {links.map((l, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  name="link_label"
                  defaultValue={l.label}
                  placeholder="Label"
                  className={`${fieldInput} w-1/3`}
                />
                <input
                  name="link_url"
                  defaultValue={l.url}
                  placeholder="https://…"
                  className={fieldInput}
                />
                <button
                  type="button"
                  onClick={() => setLinks(links.filter((_, i) => i !== idx))}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinks([...links, { label: "", url: "" }])}
              className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              + Add link
            </button>
          </div>
        </div>
        <DialogFooter
          onClose={onClose}
          onDelete={initiative ? () => run(() => deleteInitiative(initiative.id), onClose) : undefined}
          deleteLabel="Delete initiative"
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Budget tab
// ---------------------------------------------------------------------------
function BudgetTab({
  canEdit,
  periods,
  entries,
  run,
}: {
  canEdit: boolean;
  periods: MarketingBudgetPeriod[];
  entries: MarketingBudgetEntry[];
  run: Run;
}) {
  const [editingEntry, setEditingEntry] = useState<MarketingBudgetEntry | "new" | null>(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const currentYear = new Date().getFullYear();
  const period = periods.find((p) => p.year === currentYear) ?? periods[0] ?? null;

  const yearEntries = useMemo(
    () =>
      entries.filter((e) =>
        period ? e.entry_date.startsWith(String(period.year)) : true,
      ),
    [entries, period],
  );
  const spent = yearEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const budget = period?.total_budget ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : null;
  const awaitingReceipt = yearEntries.filter((e) => !e.receipt_submitted).length;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">
            {period ? `${period.year} budget` : "Budget"}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtMoney(budget)}</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditingPeriod(true)}
              className="mt-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              Edit budget
            </button>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Spent to date</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtMoney(spent)}</p>
          {pct != null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            {pct != null ? `${pct}% of budget` : "No budget set"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Remaining</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtMoney(budget - spent)}</p>
          <p className="mt-1 text-[11px] text-amber-600">
            {awaitingReceipt} awaiting receipt to accounting
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Spend log</h3>
        {canEdit && (
          <button type="button" className={btnPrimary} onClick={() => setEditingEntry("new")}>
            + Spend entry
          </button>
        )}
      </div>

      {yearEntries.length === 0 ? (
        <EmptyRow label="No spend entries yet." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Business</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {yearEntries.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer transition hover:bg-slate-50"
                  onClick={() => canEdit && setEditingEntry(e)}
                >
                  <td className="px-4 py-3 text-slate-600">{fmtDate(e.entry_date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{e.business ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{e.description ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{e.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{fmtMoney(e.amount)}</td>
                  <td className="px-4 py-3">
                    {e.receipt_submitted ? (
                      <Badge className="bg-emerald-50 text-emerald-700">Submitted</Badge>
                    ) : (
                      <Badge className="bg-amber-50 text-amber-700">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingEntry && (
        <BudgetEntryDialog
          entry={editingEntry === "new" ? null : editingEntry}
          onClose={() => setEditingEntry(null)}
          run={run}
        />
      )}
      {editingPeriod && (
        <BudgetPeriodDialog
          period={period}
          defaultYear={currentYear}
          onClose={() => setEditingPeriod(false)}
          run={run}
        />
      )}
    </section>
  );
}

function BudgetEntryDialog({
  entry,
  onClose,
  run,
}: {
  entry: MarketingBudgetEntry | null;
  onClose: () => void;
  run: Run;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveBudgetEntry(fd), onClose);
  }
  return (
    <Modal title={entry ? "Edit spend entry" : "New spend entry"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {entry && <input type="hidden" name="id" value={entry.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Date</label>
            <input type="date" name="entry_date" defaultValue={entry?.entry_date ?? new Date().toISOString().slice(0, 10)} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Amount ($)</label>
            <input name="amount" defaultValue={entry?.amount ?? ""} required className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Business / payee</label>
            <input name="business" defaultValue={entry?.business ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Category</label>
            <input name="category" defaultValue={entry?.category ?? ""} className={fieldInput} />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Description</label>
            <input name="description" defaultValue={entry?.description ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Paid by</label>
            <input name="paid_by" defaultValue={entry?.paid_by ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Payment method</label>
            <input name="payment_method" defaultValue={entry?.payment_method ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Status</label>
            <OptionsSelect name="status" defaultValue={entry?.status ?? "paid"} options={BUDGET_ENTRY_STATUSES} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="receipt_submitted" defaultChecked={entry?.receipt_submitted ?? false} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              Receipt submitted to accounting
            </label>
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Notes</label>
          <textarea name="notes" defaultValue={entry?.notes ?? ""} rows={2} className={fieldInput} />
        </div>
        <DialogFooter
          onClose={onClose}
          onDelete={entry ? () => run(() => deleteBudgetEntry(entry.id), onClose) : undefined}
          deleteLabel="Delete entry"
        />
      </form>
    </Modal>
  );
}

function BudgetPeriodDialog({
  period,
  defaultYear,
  onClose,
  run,
}: {
  period: MarketingBudgetPeriod | null;
  defaultYear: number;
  onClose: () => void;
  run: Run;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveBudgetPeriod(fd), onClose);
  }
  return (
    <Modal title="Edit budget" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Year</label>
            <input name="year" defaultValue={period?.year ?? defaultYear} required className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Total budget ($)</label>
            <input name="total_budget" defaultValue={period?.total_budget ?? ""} className={fieldInput} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Notes</label>
          <textarea name="notes" defaultValue={period?.notes ?? ""} rows={2} className={fieldInput} />
        </div>
        <DialogFooter onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Channels tab
// ---------------------------------------------------------------------------
function ChannelsTab() {
  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-500">
        Each marketing channel has its own dedicated CRM. Jump in to manage the
        detail; this hub keeps the high-level view.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETING_CHANNELS.map((c) => (
          <Link
            key={c.slug}
            href={c.href}
            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl">
              {c.icon}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-emerald-700">
                {c.label}
              </p>
              <p className="truncate text-xs text-slate-500">{c.description}</p>
            </div>
            <span className="ml-auto text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500">
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Resources tab
// ---------------------------------------------------------------------------
function ResourcesTab({
  canEdit,
  resources,
  run,
}: {
  canEdit: boolean;
  resources: MarketingResource[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingResource | "new" | null>(null);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Shared tools, portals & partner links. Passwords live in the credentials
          vault — never here.
        </p>
        {canEdit && (
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
            + Resource
          </button>
        )}
      </div>
      {resources.length === 0 ? (
        <EmptyRow label="No resources yet." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition ${canEdit ? "cursor-pointer hover:border-emerald-300 hover:shadow" : ""}`}
              onClick={() => canEdit && setEditing(r)}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{r.name}</p>
                <Badge>{resourceCategoryLabel(r.category)}</Badge>
              </div>
              {r.description && <p className="mt-1 text-xs text-slate-500">{r.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    Open ↗
                  </a>
                )}
                {r.credential_note && <span className="text-slate-400">🔐 {r.credential_note}</span>}
                {r.owner_name && <span className="text-slate-400">👤 {r.owner_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <ResourceDialog
          resource={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </section>
  );
}

function ResourceDialog({
  resource,
  onClose,
  run,
}: {
  resource: MarketingResource | null;
  onClose: () => void;
  run: Run;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveResource(fd), onClose);
  }
  return (
    <Modal title={resource ? "Edit resource" : "New resource"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {resource && <input type="hidden" name="id" value={resource.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Name</label>
            <input name="name" defaultValue={resource?.name ?? ""} required className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Category</label>
            <OptionsSelect name="category" defaultValue={resource?.category ?? "tool"} options={RESOURCE_CATEGORIES} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>URL</label>
          <input name="url" defaultValue={resource?.url ?? ""} placeholder="https://…" className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>Description</label>
          <textarea name="description" defaultValue={resource?.description ?? ""} rows={2} className={fieldInput} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Owner</label>
            <input name="owner_name" defaultValue={resource?.owner_name ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Credential note (no passwords)</label>
            <input name="credential_note" defaultValue={resource?.credential_note ?? ""} placeholder="e.g. Login in Credentials Vault" className={fieldInput} />
          </div>
        </div>
        <DialogFooter
          onClose={onClose}
          onDelete={resource ? () => run(() => deleteResource(resource.id), onClose) : undefined}
          deleteLabel="Delete resource"
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activity tab — a rollup + recent-activity feed across marketing work.
// ---------------------------------------------------------------------------
function ActivityTab({
  initiatives,
  events,
  treeNodes,
}: {
  initiatives: MarketingInitiative[];
  events: MarketingEvent[];
  treeNodes: MarketingTreeNode[];
}) {
  const feed = useMemo(() => {
    type Item = {
      id: string;
      when: string;
      kind: string;
      title: string;
      detail: string;
      icon: string;
    };
    const items: Item[] = [];
    for (const i of initiatives) {
      items.push({
        id: `i-${i.id}`,
        when: i.updated_at,
        kind: "Initiative",
        title: i.title,
        detail: `${initiativeStatusLabel(i.status)}${i.owner_name ? ` · ${i.owner_name}` : ""}`,
        icon: "🗂️",
      });
    }
    for (const e of events) {
      items.push({
        id: `e-${e.id}`,
        when: e.updated_at,
        kind: "Event",
        title: e.name,
        detail: `${eventStatusLabel(e.status)}${e.starts_on ? ` · ${fmtDate(e.starts_on)}` : ""}`,
        icon: "🎪",
      });
    }
    for (const n of treeNodes) {
      items.push({
        id: `n-${n.id}`,
        when: n.updated_at,
        kind: "Tree node",
        title: n.label,
        detail: n.status.replace("_", " "),
        icon: "🌳",
      });
    }
    return items
      .filter((x) => x.when)
      .sort((a, b) => b.when.localeCompare(a.when))
      .slice(0, 40);
  }, [initiatives, events, treeNodes]);

  const initByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of initiatives) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [initiatives]);

  const attentionNodes = treeNodes.filter((n) => n.status === "needs_attention");
  const upcomingEvents = events.filter(
    (e) => e.status !== "completed" && e.status !== "cancelled",
  ).length;

  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatBox label="Active initiatives" value={String(initByStatus.get("in_progress") ?? 0)} />
        <StatBox label="Upcoming events" value={String(upcomingEvents)} />
        <StatBox label="Tree nodes" value={String(treeNodes.filter((n) => n.status !== "archived").length)} />
        <StatBox label="Need attention" value={String(attentionNodes.length)} tone={attentionNodes.length ? "amber" : "slate"} />
      </div>

      {attentionNodes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Flagged — needs attention</p>
          <ul className="mt-1.5 space-y-1 text-sm text-amber-700">
            {attentionNodes.map((n) => (
              <li key={n.id}>• {n.label}{n.owner_name ? ` — ${n.owner_name}` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Recent activity</h3>
        {feed.length === 0 ? (
          <EmptyRow label="No activity yet." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {feed.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-base" aria-hidden>{x.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{x.title}</p>
                    <p className="text-xs text-slate-400">{x.kind} · {x.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(x.when).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function StatBox({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-bold ${tone === "amber" ? "text-amber-600" : "text-slate-900"}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function EmptyRow({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">
      {label}
    </p>
  );
}
