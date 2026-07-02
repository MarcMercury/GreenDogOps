"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SetupData } from "../data";
import {
  gridName,
  timeRange,
  DAY_SHORT,
  type SchedDepartment,
  type SchedRole,
  type SchedShiftTemplate,
} from "@/lib/schedule/types";
import { formatAddress } from "@/lib/shared/locations";
import {
  saveDepartment,
  deleteDepartment,
  saveRole,
  deleteRole,
  toggleRoleMember,
  saveShiftTemplate,
  deleteShiftTemplate,
  saveEmployeeSetting,
} from "../actions";

type SubTab = "departments" | "roles" | "shifts" | "employees" | "locations";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "departments", label: "Departments" },
  { key: "roles", label: "Roles & Eligibility" },
  { key: "shifts", label: "Week Template" },
  { key: "employees", label: "Employees" },
  { key: "locations", label: "Locations" },
];

// --- small shared bits -----------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {children}
    </div>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const btnPrimary =
  "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50";

export function SetupManager({ data }: { data: SetupData }) {
  const [tab, setTab] = useState<SubTab>("departments");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "departments" && <Departments data={data} />}
      {tab === "roles" && <Roles data={data} />}
      {tab === "shifts" && <Shifts data={data} />}
      {tab === "employees" && <Employees data={data} />}
      {tab === "locations" && <Locations data={data} />}
    </div>
  );
}

// ===========================================================================
// Departments
// ===========================================================================

function Departments({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SchedDepartment | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveDepartment(fd);
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Departments ({data.departments.length})
        </h2>
        <ul className="divide-y divide-slate-100">
          {data.departments.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <span
                className="h-4 w-4 shrink-0 rounded"
                style={{ background: d.color }}
              />
              <span className="flex-1 text-sm font-medium text-slate-800">
                {d.name}
                {d.code ? (
                  <span className="ml-2 text-xs text-slate-400">{d.code}</span>
                ) : null}
              </span>
              {!d.is_active && (
                <span className="text-xs text-slate-400">inactive</span>
              )}
              {d.show_in_planning && (
                <span
                  className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                  title="Appears in the Planning Guides department dropdown"
                >
                  Planning
                </span>
              )}
              <button
                onClick={() => setEditing(d)}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() =>
                  start(async () => {
                    await deleteDepartment(d.id);
                    router.refresh();
                  })
                }
                className="text-xs font-medium text-red-500 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
          {data.departments.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">
              No departments yet. Add one to start.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {editing ? "Edit department" : "New department"}
        </h2>
        <form
          action={submit}
          className="space-y-3"
          key={editing?.id ?? "new"}
        >
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <label className="block text-xs font-medium text-slate-500">
            Name
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              required
              className={`mt-1 w-full ${inputCls}`}
              placeholder="VET-SURGERY"
            />
          </label>
          <div className="flex gap-3">
            <label className="block text-xs font-medium text-slate-500">
              Code
              <input
                name="code"
                defaultValue={editing?.code ?? ""}
                className={`mt-1 w-full ${inputCls}`}
                placeholder="SURG"
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              Order
              <input
                name="sort_order"
                type="number"
                defaultValue={editing?.sort_order ?? 0}
                className={`mt-1 w-20 ${inputCls}`}
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-500">
            Color
            <input
              name="color"
              type="color"
              defaultValue={editing?.color ?? "#64748b"}
              className="mt-1 block h-9 w-16 cursor-pointer rounded border border-slate-300"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing?.is_active ?? true}
            />
            Active
          </label>
          <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              name="show_in_planning"
              defaultChecked={editing?.show_in_planning ?? false}
              className="mt-0.5"
            />
            <span>
              Planning Guide
              <span className="block font-normal text-slate-400">
                Show this department in the Planning Guides dropdown.
              </span>
            </span>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {editing ? "Save" : "Add"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className={btnGhost}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

// ===========================================================================
// Roles & Eligibility
// ===========================================================================

function Roles({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);

  // Optimistic eligibility set, keyed by "roleId:personId".
  const [elig, setElig] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const m of data.members) s.add(`${m.role_id}:${m.person_id}`);
    return s;
  });

  // Roles grouped by department, in configured order — drives the columns.
  const deptGroups = useMemo(
    () =>
      data.departments
        .map((dept) => ({
          dept,
          roles: data.roles
            .filter((r) => r.department_id === dept.id)
            .sort((a, b) => a.sort_order - b.sort_order),
        }))
        .filter((g) => g.roles.length > 0),
    [data.departments, data.roles],
  );
  const orderedRoles = useMemo(
    () => deptGroups.flatMap((g) => g.roles),
    [deptGroups],
  );

  // Employees — the rows.
  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.people
      .filter((p) => !term || gridName(p).toLowerCase().includes(term))
      .sort((a, b) => gridName(a).localeCompare(gridName(b)));
  }, [data.people, q]);

  async function toggle(roleId: string, personId: string) {
    const key = `${roleId}:${personId}`;
    const wasEligible = elig.has(key);
    setError(null);
    setElig((prev) => {
      const next = new Set(prev);
      if (wasEligible) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaving((n) => n + 1);
    const res = await toggleRoleMember(roleId, personId, !wasEligible);
    setSaving((n) => n - 1);
    if (!res.ok) {
      // Revert on failure.
      setElig((prev) => {
        const next = new Set(prev);
        if (wasEligible) next.add(key);
        else next.delete(key);
        return next;
      });
      setError(res.error);
    }
  }

  function removeRole(r: SchedRole) {
    if (
      !window.confirm(
        `Delete role “${r.name}”? This clears every employee's eligibility for it.`,
      )
    )
      return;
    start(async () => {
      const res = await deleteRole(r.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const colCount = orderedRoles.length + 1;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              Eligibility matrix
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Check a box to make an employee eligible for a role. Changes save
              instantly and mirror the HR profile &amp; schedule grid.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saving > 0 && (
              <span className="text-[11px] text-slate-400">Saving…</span>
            )}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employees…"
              className={inputCls}
            />
          </div>
        </div>
        <AddRoleForm data={data} onSaved={() => router.refresh()} />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </Card>

      {orderedRoles.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">
            Add a role above to start assigning eligibility.
          </p>
        </Card>
      ) : (
        <div className="relative max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 top-0 z-40 min-w-[13rem] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-600"
                >
                  Employee
                </th>
                {deptGroups.map((g) => (
                  <th
                    key={g.dept.id}
                    colSpan={g.roles.length}
                    className="sticky top-0 z-30 h-9 whitespace-nowrap border-b border-r border-slate-200 px-3 text-center text-xs font-semibold text-white"
                    style={{ background: g.dept.color }}
                  >
                    {g.dept.name}
                  </th>
                ))}
              </tr>
              <tr>
                {orderedRoles.map((r) => (
                  <th
                    key={r.id}
                    className="group sticky top-9 z-30 min-w-[3.5rem] whitespace-nowrap border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center align-bottom text-[11px] font-medium text-slate-600"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>{r.name}</span>
                      <button
                        type="button"
                        onClick={() => removeRole(r)}
                        disabled={pending}
                        title="Delete role"
                        className="text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left text-sm font-normal text-slate-800 group-hover:bg-emerald-50"
                  >
                    {gridName(p)}
                  </th>
                  {orderedRoles.map((r) => {
                    const checked = elig.has(`${r.id}:${p.id}`);
                    return (
                      <td
                        key={r.id}
                        className="border-b border-r border-slate-100 px-2 py-1.5 text-center group-hover:bg-emerald-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(r.id, p.id)}
                          className="h-4 w-4 cursor-pointer accent-emerald-600"
                          aria-label={`${gridName(p)} eligible for ${r.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-3 py-6 text-center text-xs text-slate-400"
                  >
                    No employees match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddRoleForm({
  data,
  onSaved,
}: {
  data: SetupData;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveRole(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      onSaved();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
    >
      <label className="text-xs font-medium text-slate-500">
        Department
        <select
          name="department_id"
          required
          defaultValue=""
          className={`mt-1 block ${inputCls}`}
        >
          <option value="">Select…</option>
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-500">
        New role / title
        <input
          name="name"
          required
          placeholder="Surgery Tech"
          className={`mt-1 block ${inputCls}`}
        />
      </label>
      <label className="text-xs font-medium text-slate-500">
        Order
        <input
          name="sort_order"
          type="number"
          defaultValue={0}
          className={`mt-1 block w-20 ${inputCls}`}
        />
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        Add role
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

// ===========================================================================
// Week Template (shift template lines)
// ===========================================================================

function Shifts({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SchedShiftTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rolesByDept = useMemo(() => {
    const m = new Map<string, SchedRole[]>();
    for (const r of data.roles) {
      if (!m.has(r.department_id)) m.set(r.department_id, []);
      m.get(r.department_id)!.push(r);
    }
    return m;
  }, [data.roles]);

  const roleName = (id: string | null) =>
    id ? data.roles.find((r) => r.id === id)?.name ?? "—" : "—";

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveShiftTemplate(fd);
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  const [formDept, setFormDept] = useState<string>(editing?.department_id ?? "");
  const formRoles = rolesByDept.get(formDept) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Week template
        </h2>
        <div className="space-y-4">
          {data.departments.map((dept) => {
            const lines = data.templates.filter(
              (t) => t.department_id === dept.id,
            );
            return (
              <div key={dept.id}>
                <p
                  className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: dept.color }}
                >
                  {dept.name}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {lines.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 text-sm text-slate-800">
                        {t.label || roleName(t.role_id)}
                        <span className="ml-2 font-mono text-xs text-slate-400">
                          {timeRange(t.start_time, t.end_time)}
                        </span>
                      </span>
                      <button
                        onClick={() => {
                          setEditing(t);
                          setFormDept(t.department_id);
                        }}
                        className="text-xs font-medium text-slate-500 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          start(async () => {
                            await deleteShiftTemplate(t.id);
                            router.refresh();
                          })
                        }
                        className="text-xs font-medium text-red-500 hover:underline"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {lines.length === 0 && (
                    <li className="px-3 py-2 text-xs text-slate-400">
                      No template lines.
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {editing ? "Edit template line" : "New template line"}
        </h2>
        <form action={submit} className="space-y-3" key={editing?.id ?? "new"}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <label className="block text-xs font-medium text-slate-500">
            Department
            <select
              name="department_id"
              value={formDept}
              onChange={(e) => setFormDept(e.target.value)}
              required
              className={`mt-1 w-full ${inputCls}`}
            >
              <option value="">Select…</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Role (eligibility)
            <select
              name="role_id"
              defaultValue={editing?.role_id ?? ""}
              className={`mt-1 w-full ${inputCls}`}
            >
              <option value="">— any —</option>
              {formRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Label (optional)
            <input
              name="label"
              defaultValue={editing?.label ?? ""}
              className={`mt-1 w-full ${inputCls}`}
              placeholder="Defaults to role name"
            />
          </label>
          <div className="flex gap-3">
            <label className="block text-xs font-medium text-slate-500">
              Start
              <input
                name="start_time"
                type="time"
                defaultValue={editing?.start_time ?? ""}
                className={`mt-1 w-full ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              End
              <input
                name="end_time"
                type="time"
                defaultValue={editing?.end_time ?? ""}
                className={`mt-1 w-full ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              Order
              <input
                name="sort_order"
                type="number"
                defaultValue={editing?.sort_order ?? 0}
                className={`mt-1 w-16 ${inputCls}`}
              />
            </label>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {editing ? "Save" : "Add"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormDept("");
                }}
                className={btnGhost}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

// ===========================================================================
// Employees
// ===========================================================================

function Employees({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");

  const settingByPerson = useMemo(() => {
    const m = new Map(data.settings.map((s) => [s.person_id, s]));
    return m;
  }, [data.settings]);

  // Default eligibility for employees with no explicit selection: every
  // location except MPMV (i.e. SO, VEN, VAN). Mirrors the schedule grid which
  // also excludes MPMV.
  const defaultEligibleLocIds = useMemo(
    () =>
      data.locations
        .filter((l) => (l.short_code ?? l.name).toUpperCase() !== "MPMV")
        .map((l) => l.id),
    [data.locations],
  );

  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.people
      .filter((p) => !term || gridName(p).toLowerCase().includes(term))
      .sort((a, b) => gridName(a).localeCompare(gridName(b)));
  }, [data.people, q]);

  function update(
    personId: string,
    patch: {
      target?: number;
      schedulable?: boolean;
      loc?: string | null;
      eligibleLocs?: string[];
      days?: number[];
    },
  ) {
    const cur = settingByPerson.get(personId);
    const target = patch.target ?? cur?.weekly_shift_target ?? 5;
    const schedulable = patch.schedulable ?? cur?.is_schedulable ?? true;
    const loc =
      patch.loc !== undefined ? patch.loc : cur?.default_location_id ?? null;
    const eligibleLocs =
      patch.eligibleLocs ?? cur?.eligible_location_ids ?? [];
    const days = patch.days ?? cur?.available_days ?? [];
    start(async () => {
      await saveEmployeeSetting(
        personId,
        target,
        schedulable,
        loc,
        eligibleLocs,
        days,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Employee scheduling settings
        </h2>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className={inputCls}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2 pr-4 font-medium">Employee</th>
              <th className="py-2 pr-4 font-medium">Weekly target</th>
              <th className="py-2 pr-4 font-medium">Eligible locations</th>
              <th className="py-2 pr-4 font-medium">Available days</th>
              <th className="py-2 pr-4 font-medium">Schedulable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => {
              const s = settingByPerson.get(p.id);
              return (
                <tr key={p.id} className={pending ? "opacity-70" : ""}>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    <Link
                      href={`/hr/${p.id}`}
                      className="text-slate-800 hover:text-emerald-700 hover:underline"
                      title="Open HR profile"
                    >
                      {gridName(p)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      min={0}
                      max={7}
                      defaultValue={s?.weekly_shift_target ?? 5}
                      onBlur={(e) =>
                        update(p.id, { target: Number(e.target.value) })
                      }
                      className={`w-16 ${inputCls}`}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        const schedulable = s?.is_schedulable ?? true;
                        const eligible = !schedulable
                          ? []
                          : s?.eligible_location_ids?.length
                            ? s.eligible_location_ids
                            : defaultEligibleLocIds;
                        return data.locations.map((l) => {
                          const on = eligible.includes(l.id);
                          return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              const next = on
                                ? eligible.filter((x) => x !== l.id)
                                : [...eligible, l.id];
                              update(p.id, { eligibleLocs: next });
                            }}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                              on
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                            title={
                              on
                                ? `Eligible at ${l.name}`
                                : `Not eligible at ${l.name}`
                            }
                          >
                            {l.short_code || l.name}
                          </button>
                          );
                        });
                      })()}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      None = any location
                    </p>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {DAY_SHORT.map((label, day) => {
                        const on = (s?.available_days ?? []).includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              const cur = s?.available_days ?? [];
                              const next = on
                                ? cur.filter((x) => x !== day)
                                : [...cur, day];
                              update(p.id, { days: next });
                            }}
                            className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium transition ${
                              on
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      None = any day
                    </p>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="checkbox"
                      defaultChecked={s?.is_schedulable ?? true}
                      onChange={(e) =>
                        update(
                          p.id,
                          e.target.checked
                            ? { schedulable: true }
                            : { schedulable: false, eligibleLocs: [] },
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ===========================================================================
// Locations (read-only — managed in Admin → Locations, the source of truth)
// ===========================================================================

function Locations({ data }: { data: SetupData }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Locations</h2>
        <a
          href="/admin/locations"
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          Manage in Admin → Locations
        </a>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Locations are managed centrally in Admin so Settings and the schedule
        always match. Active locations below appear as columns on the grid.
      </p>
      <ul className="divide-y divide-slate-100">
        {data.locations
          .filter((l) => l.is_active)
          .map((l) => {
            const address = formatAddress(l);
            return (
              <li key={l.id} className="flex items-start gap-3 py-2">
                <span
                  className="mt-1 h-4 w-4 shrink-0 rounded"
                  style={{ background: l.color ?? "#64748b" }}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {l.name}
                    {l.short_code ? (
                      <span className="ml-2 text-xs text-slate-400">
                        {l.short_code}
                      </span>
                    ) : null}
                  </p>
                  {address ? (
                    <p className="text-xs text-slate-400">{address}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
