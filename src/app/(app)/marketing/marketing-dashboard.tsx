"use client";

import { useMemo, useState, useTransition } from "react";
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
  type MarketingPromotion,
  type PersonOption,
  type MarketingActivity,
  type CrmOrgRef,
  type InitiativeLink,
  INITIATIVE_CATEGORIES,
  INITIATIVE_STATUSES,
  PRIORITIES,
  BUDGET_ENTRY_STATUSES,
  RESOURCE_CATEGORIES,
  PROMO_STATUSES,
  PROMO_TYPES,
  initiativeCategoryLabel,
  initiativeStatusLabel,
  priorityLabel,
  resourceCategoryLabel,
  promoStatusLabel,
  promoTypeLabel,
  treeZoneLabel,
  personLabel,
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
  savePromotion,
  deletePromotion,
  type ActionResult,
} from "./actions";
import { useTableSort, SortHeader } from "../_components/data-views";
import { OwnerSelect } from "./owner-select";

// ---------------------------------------------------------------------------
// Shared styles + helpers
// ---------------------------------------------------------------------------
const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const filterSelect =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
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

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("canva")) return "Canva";
    if (host.includes("docs.google")) return "Google Doc";
    if (host.includes("drive.google")) return "Drive";
    if (host.includes("figma")) return "Figma";
    const base = host.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Link";
  }
}

function NextActionCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const urlMatch = value.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    const idx = urlMatch.index ?? 0;
    const text = [value.slice(0, idx).trim(), value.slice(idx + url.length).trim()]
      .filter(Boolean)
      .join(" ");
    return (
      <div className="space-y-0.5 text-xs leading-snug">
        {text && <span className="block break-words text-slate-600">{text}</span>}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
        >
          🔗 {linkLabel(url)}
        </a>
      </div>
    );
  }
  return <span className="block break-words text-xs leading-snug text-slate-600">{value}</span>;
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
type TabKey = "tree" | "initiatives" | "events" | "promotions" | "activity" | "budget" | "resources";
const BASE_TABS: { key: TabKey; label: string; icon: string; adminOnly?: boolean }[] = [
  { key: "tree", label: "Marketing Tree", icon: "🌳" },
  { key: "initiatives", label: "Goals & Initiatives", icon: "🗂️" },
  { key: "events", label: "Events", icon: "🎪" },
  { key: "promotions", label: "Promotions", icon: "🏷️" },
  { key: "activity", label: "Activity", icon: "📈" },
  { key: "budget", label: "Budget", icon: "💵", adminOnly: true },
  { key: "resources", label: "Resources", icon: "🧰" },
];

export function MarketingDashboard({
  canEdit,
  isAdmin,
  canViewCredentials,
  goals,
  initiatives,
  events,
  budgetPeriods,
  budgetEntries,
  resources,
  treeNodes,
  eventSources,
  eventAttendees,
  promotions,
  people,
  activity,
  crmOrgs,
}: {
  canEdit: boolean;
  isAdmin: boolean;
  canViewCredentials: boolean;
  goals: MarketingGoal[];
  initiatives: MarketingInitiative[];
  events: MarketingEvent[];
  budgetPeriods: MarketingBudgetPeriod[];
  budgetEntries: MarketingBudgetEntry[];
  resources: MarketingResource[];
  treeNodes: MarketingTreeNode[];
  eventSources: MarketingEventSource[];
  eventAttendees: MarketingEventAttendee[];
  promotions: MarketingPromotion[];
  people: PersonOption[];
  activity: MarketingActivity[];
  crmOrgs: CrmOrgRef[];
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

      {tab === "tree" && <MarketingTree canEdit={canEdit} nodes={treeNodes} people={people} />}
      {tab === "initiatives" && (
        <InitiativesTab canEdit={canEdit} initiatives={initiatives} goals={visibleGoals} people={people} run={run} />
      )}
      {tab === "events" && (
        <EventsTab
          canEdit={canEdit}
          events={events}
          sources={eventSources}
          attendees={eventAttendees}
          crmOrgs={crmOrgs}
          people={people}
        />
      )}
      {tab === "activity" && (
        <ActivityTab
          activity={activity}
          treeNodes={treeNodes}
          people={people}
        />
      )}
      {tab === "promotions" && (
        <PromotionsTab canEdit={canEdit} promotions={promotions} run={run} />
      )}
      {tab === "budget" && isAdmin && (
        <BudgetTab
          canEdit={canEdit}
          periods={budgetPeriods}
          entries={budgetEntries}
          run={run}
        />
      )}
      {tab === "resources" && (
        <ResourcesTab canEdit={canEdit} canViewCredentials={canViewCredentials} resources={resources} people={people} run={run} />
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
  goals,
  people,
  run,
}: {
  canEdit: boolean;
  initiatives: MarketingInitiative[];
  goals: MarketingGoal[];
  people: PersonOption[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingInitiative | "new" | null>(null);
  const [editingGoal, setEditingGoal] = useState<MarketingGoal | "new" | null>(null);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");

  const activeGoals = useMemo(() => goals.filter((g) => g.is_active), [goals]);

  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          initiatives
            .map((i) => i.owner_name?.trim())
            .filter((o): o is string => !!o),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [initiatives],
  );

  const filtered = useMemo(
    () =>
      initiatives.filter(
        (i) =>
          (!category || i.category === category) &&
          (!status || i.status === status) &&
          (!owner || i.owner_name === owner) &&
          (!priority || i.priority === priority),
      ),
    [initiatives, category, status, owner, priority],
  );

  const iSort = useTableSort(filtered, {
    initiative: (i) => i.title,
    owner: (i) => i.owner_name,
    partner: (i) => i.partner_name,
    nextAction: (i) => i.next_action,
    due: (i) => i.due_date,
    status: (i) => i.status,
  });

  return (
    <section className="space-y-4">
      {/* Goals — list form */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Goals & KPIs
          </h2>
          {canEdit && (
            <button type="button" className={btnGhost} onClick={() => setEditingGoal("new")}>
              + Goal
            </button>
          )}
        </div>
        {activeGoals.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No goals yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activeGoals.map((g) => {
              const pct =
                g.target_value && g.target_value > 0
                  ? Math.min(100, Math.round(((g.current_value ?? 0) / g.target_value) * 100))
                  : null;
              const isMoney = (g.metric_unit ?? "").trim() === "$";
              const fmt = isMoney ? fmtMoney : fmtNum;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && setEditingGoal(g)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition enabled:hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{g.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {[g.period, g.category].filter(Boolean).join(" · ") || "\u00A0"}
                      </p>
                    </div>
                    {pct != null && (
                      <div className="hidden w-40 shrink-0 sm:block">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-right text-[10px] text-slate-400">{pct}%</p>
                      </div>
                    )}
                    <div className="w-28 shrink-0 text-right text-sm font-semibold text-slate-900">
                      {fmt(g.current_value ?? 0)}
                      {g.target_value != null && (
                        <span className="text-xs font-medium text-slate-400"> / {fmt(g.target_value)}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={filterSelect}>
          <option value="">All categories</option>
          {INITIATIVE_CATEGORIES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterSelect}>
          <option value="">All statuses</option>
          {INITIATIVE_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={filterSelect}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={filterSelect}>
          <option value="">All priorities</option>
          {PRIORITIES.map((o) => (
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
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[13%]" />
              <col className="w-[14%]" />
              <col className="w-[22%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader label="Initiative" sortKey="initiative" sort={iSort} className="px-3 py-2.5 font-semibold" />
                <SortHeader label="Owner" sortKey="owner" sort={iSort} className="px-3 py-2.5 font-semibold" />
                <SortHeader label="3rd party" sortKey="partner" sort={iSort} className="px-3 py-2.5 font-semibold" />
                <SortHeader label="Next action" sortKey="nextAction" sort={iSort} className="px-3 py-2.5 font-semibold" />
                <SortHeader label="Due" sortKey="due" sort={iSort} className="px-3 py-2.5 font-semibold" />
                <SortHeader label="Status" sortKey="status" sort={iSort} className="px-3 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {iSort.sorted.map((i) => (
                <tr
                  key={i.id}
                  className="cursor-pointer transition hover:bg-slate-50"
                  onClick={() => canEdit && setEditing(i)}
                >
                  <td className="px-3 py-3 align-top">
                    <div className="break-words font-medium text-slate-900">{i.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{initiativeCategoryLabel(i.category)}</Badge>
                      <Badge className={PRIORITY_COLORS[i.priority]}>
                        {priorityLabel(i.priority)}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top break-words text-slate-600">{i.owner_name ?? "—"}</td>
                  <td className="px-3 py-3 align-top break-words text-slate-600">{i.partner_name ?? "—"}</td>
                  <td className="px-3 py-3 align-top"><NextActionCell value={i.next_action} /></td>
                  <td className="px-3 py-3 align-top text-slate-600">{fmtDate(i.due_date)}</td>
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
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
          people={people}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}

      {editingGoal && (
        <GoalDialog
          goal={editingGoal === "new" ? null : editingGoal}
          onClose={() => setEditingGoal(null)}
          run={run}
        />
      )}
    </section>
  );
}

function InitiativeDialog({
  initiative,
  people,
  onClose,
  run,
}: {
  initiative: MarketingInitiative | null;
  people: PersonOption[];
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
            <OwnerSelect name="owner_name" people={people} defaultValue={initiative?.owner_name ?? ""} className={fieldInput} />
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

  const bSort = useTableSort(yearEntries, {
    date: (e) => e.entry_date,
    business: (e) => e.business,
    description: (e) => e.description,
    category: (e) => e.category,
    amount: (e) => e.amount,
    receipt: (e) => (e.receipt_submitted ? 1 : 0),
  });

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
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader label="Date" sortKey="date" sort={bSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Business" sortKey="business" sort={bSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Description" sortKey="description" sort={bSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Category" sortKey="category" sort={bSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Amount" sortKey="amount" sort={bSort} align="right" className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Receipt" sortKey="receipt" sort={bSort} className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bSort.sorted.map((e) => (
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
// Resources tab
// ---------------------------------------------------------------------------
function ResourceLoginCell({
  resource,
  canView,
}: {
  resource: MarketingResource;
  canView: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasLogin = Boolean(resource.username || resource.password || resource.credential_note);

  if (!hasLogin) return <span className="text-slate-400">—</span>;
  if (!canView) return <span className="text-xs text-slate-400">🔒 Restricted</span>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
      >
        Click For Login and Password
      </button>
    );
  }

  return (
    <div className="space-y-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
      {resource.username && (
        <div>
          <span className="text-slate-400">User: </span>
          <span className="font-mono text-slate-700">{resource.username}</span>
        </div>
      )}
      {resource.password && (
        <div>
          <span className="text-slate-400">Pass: </span>
          <span className="font-mono text-slate-700">{resource.password}</span>
        </div>
      )}
      {resource.credential_note && <div className="text-slate-400">{resource.credential_note}</div>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
        }}
        className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline"
      >
        Hide
      </button>
    </div>
  );
}

function ResourcesTab({
  canEdit,
  canViewCredentials,
  resources,
  people,
  run,
}: {
  canEdit: boolean;
  canViewCredentials: boolean;
  resources: MarketingResource[];
  people: PersonOption[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingResource | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "category" | "owner">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(k: "name" | "category" | "owner") {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: MarketingResource): string => {
      if (sortKey === "category") return resourceCategoryLabel(r.category).toLowerCase();
      if (sortKey === "owner") return (r.owner_name ?? "").toLowerCase();
      return r.name.toLowerCase();
    };
    return resources
      .filter((r) => {
        if (category && r.category !== category) return false;
        if (!q) return true;
        return `${r.name} ${r.description ?? ""} ${r.owner_name ?? ""} ${r.url ?? ""}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        const cmp = val(a).localeCompare(val(b));
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [resources, query, category, sortKey, sortDir]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resources) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [resources]);

  const sortArrow = (k: string) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search resources…"
          className={`${fieldInput} w-64`}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All categories</option>
          {RESOURCE_CATEGORIES.filter((c) => cats.has(c.value)).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({cats.get(c.value)})
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-400">{filtered.length} shown</span>
        {canEdit && (
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setEditing("new")}>
            + Resource
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyRow label="No resources match." />
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="cursor-pointer select-none px-4 py-2.5 font-semibold" onClick={() => toggleSort("name")}>Name{sortArrow("name")}</th>
                <th className="cursor-pointer select-none px-4 py-2.5 font-semibold" onClick={() => toggleSort("category")}>Category{sortArrow("category")}</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="cursor-pointer select-none px-4 py-2.5 font-semibold" onClick={() => toggleSort("owner")}>Owner{sortArrow("owner")}</th>
                <th className="px-4 py-2.5 font-semibold">Link</th>
                <th className="px-4 py-2.5 font-semibold">Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer align-top transition hover:bg-slate-50"
                  onClick={() => canEdit && setEditing(r)}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Badge>{resourceCategoryLabel(r.category)}</Badge></td>
                  <td className="px-4 py-2.5 text-slate-500">{r.description ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.owner_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-emerald-700 hover:text-emerald-800"
                      >
                        Open ↗
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    <ResourceLoginCell resource={r} canView={canViewCredentials} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ResourceDialog
          resource={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </section>
  );
}

function ResourceDialog({
  resource,
  people,
  onClose,
  run,
}: {
  resource: MarketingResource | null;
  people: PersonOption[];
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
            <OwnerSelect name="owner_name" people={people} defaultValue={resource?.owner_name ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Credential note</label>
            <input name="credential_note" defaultValue={resource?.credential_note ?? ""} placeholder="e.g. shared team login" className={fieldInput} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Username</label>
            <input name="username" defaultValue={resource?.username ?? ""} autoComplete="off" className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Password</label>
            <input name="password" defaultValue={resource?.password ?? ""} autoComplete="off" className={fieldInput} />
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
// Promotions tab — the live promo/coupon reference (codes, redemption, rules).
// ---------------------------------------------------------------------------
const PROMO_STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  upcoming: "bg-sky-50 text-sky-700",
  expired: "bg-slate-100 text-slate-500",
};

function PromotionsTab({
  canEdit,
  promotions,
  run,
}: {
  canEdit: boolean;
  promotions: MarketingPromotion[];
  run: Run;
}) {
  const [editing, setEditing] = useState<MarketingPromotion | "new" | null>(null);
  const [status, setStatus] = useState("active");
  const [type, setType] = useState("");

  const filtered = useMemo(
    () =>
      promotions.filter(
        (p) =>
          (!status || p.status === status) && (!type || p.promo_type === type),
      ),
    [promotions, status, type],
  );

  const pSort = useTableSort(filtered, {
    promotion: (p) => p.name,
    placement: (p) => p.placement,
    discount: (p) => p.discount_text,
    code: (p) => p.product_code,
    duration: (p) => p.duration_text,
    status: (p) => p.status,
  });

  const counts = useMemo(() => {
    const m = { active: 0, upcoming: 0, expired: 0 } as Record<string, number>;
    for (const p of promotions) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [promotions]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All statuses</option>
          {PROMO_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({counts[o.value] ?? 0})
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All types</option>
          {PROMO_TYPES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-sm text-slate-400">{filtered.length} shown</span>
        <div className="ml-auto">
          {canEdit && (
            <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
              + Promotion
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyRow label="No promotions match." />
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader label="Promotion" sortKey="promotion" sort={pSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Placement" sortKey="placement" sort={pSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Discount" sortKey="discount" sort={pSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Code" sortKey="code" sort={pSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Duration" sortKey="duration" sort={pSort} className="px-4 py-2.5 font-semibold" />
                <SortHeader label="Status" sortKey="status" sort={pSort} className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pSort.sorted.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer align-top transition hover:bg-slate-50"
                  onClick={() => canEdit && setEditing(p)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge>{promoTypeLabel(p.promo_type)}</Badge>
                      {p.promo_url && (
                        <a
                          href={p.promo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                        >
                          link ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.placement ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.discount_text ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.product_code ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.duration_text ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={PROMO_STATUS_COLORS[p.status]}>{promoStatusLabel(p.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PromotionDialog
          promo={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </section>
  );
}

function PromotionDialog({
  promo,
  onClose,
  run,
}: {
  promo: MarketingPromotion | null;
  onClose: () => void;
  run: Run;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => savePromotion(fd), onClose);
  }
  return (
    <Modal title={promo ? "Edit promotion" : "New promotion"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {promo && <input type="hidden" name="id" value={promo.id} />}
        <div>
          <label className={fieldLabel}>Promotion name</label>
          <input name="name" defaultValue={promo?.name ?? ""} required className={fieldInput} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={fieldLabel}>Status</label>
            <OptionsSelect name="status" defaultValue={promo?.status ?? "active"} options={PROMO_STATUSES} />
          </div>
          <div>
            <label className={fieldLabel}>Type</label>
            <OptionsSelect name="promo_type" defaultValue={promo?.promo_type ?? "standard"} options={PROMO_TYPES} />
          </div>
          <div>
            <label className={fieldLabel}>Duration</label>
            <input name="duration_text" defaultValue={promo?.duration_text ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Placement</label>
            <input name="placement" defaultValue={promo?.placement ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Discount</label>
            <input name="discount_text" defaultValue={promo?.discount_text ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Product code</label>
            <input name="product_code" defaultValue={promo?.product_code ?? ""} className={fieldInput} />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>ezyVet line item</label>
            <input name="ezyvet_line_item" defaultValue={promo?.ezyvet_line_item ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>How to redeem</label>
            <input name="how_to_redeem" defaultValue={promo?.how_to_redeem ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Promo link</label>
            <input name="promo_url" defaultValue={promo?.promo_url ?? ""} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Booking / widget URL</label>
            <input name="booking_url" defaultValue={promo?.booking_url ?? ""} className={fieldInput} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Rules</label>
          <textarea name="rules" defaultValue={promo?.rules ?? ""} rows={2} className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>Notes</label>
          <textarea name="notes" defaultValue={promo?.notes ?? ""} rows={2} className={fieldInput} />
        </div>
        <DialogFooter
          onClose={onClose}
          onDelete={promo ? () => run(() => deletePromotion(promo.id), onClose) : undefined}
          deleteLabel="Delete promotion"
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activity tab — the marketing activity log + node priorities / staleness.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}
const ACTIVITY_ICON: Record<string, string> = {
  node_handled: "✅",
  node_created: "🌱",
  node_saved: "✏️",
};

function ActivityTab({
  activity,
  treeNodes,
  people,
}: {
  activity: MarketingActivity[];
  treeNodes: MarketingTreeNode[];
  people: PersonOption[];
}) {
  const personName = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, personLabel(p)]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [people]);

  const live = treeNodes.filter((n) => n.status !== "archived");
  const attentionNodes = live.filter((n) => n.status === "needs_attention");
  const staleNodes = live.filter((n) => {
    const d = daysSince(n.last_handled_at);
    return d == null || d > 30;
  });
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const focus = [...live]
    .sort(
      (a, b) =>
        (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) ||
        (daysSince(b.last_handled_at) ?? 9999) - (daysSince(a.last_handled_at) ?? 9999),
    )
    .slice(0, 12);

  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatBox label="Active nodes" value={String(live.length)} />
        <StatBox label="High priority" value={String(live.filter((n) => n.priority === "high").length)} />
        <StatBox label="Need attention" value={String(attentionNodes.length)} tone={attentionNodes.length ? "amber" : "slate"} />
        <StatBox label="Stale (30d+)" value={String(staleNodes.length)} tone={staleNodes.length ? "amber" : "slate"} />
      </div>

      {/* Priority focus — driven by node priority + staleness */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Focus — by priority</h3>
        {focus.length === 0 ? (
          <EmptyRow label="No nodes yet." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {focus.map((n) => {
                const d = daysSince(n.last_handled_at);
                return (
                  <li key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge className={PRIORITY_COLORS[n.priority]}>{priorityLabel(n.priority)}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{n.label}</p>
                      <p className="text-xs text-slate-400">
                        {[treeZoneLabel(n.zone), personName(n.owner_person_id) ?? n.owner_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {n.status === "needs_attention" && <Badge className="bg-amber-50 text-amber-700">Attention</Badge>}
                    <span className="shrink-0 text-xs text-slate-400">
                      {d == null ? "never handled" : d === 0 ? "today" : `${d}d ago`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Activity log */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Recent activity</h3>
        {activity.length === 0 ? (
          <EmptyRow label="No activity logged yet. Actions on nodes will appear here." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-base" aria-hidden>{ACTIVITY_ICON[a.kind] ?? "•"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{a.title}</p>
                    <p className="text-xs text-slate-400">
                      {[a.detail, a.actor].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
