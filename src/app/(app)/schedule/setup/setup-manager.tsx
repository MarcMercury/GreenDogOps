"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  setRoleMembers,
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
  const [editing, setEditing] = useState<SchedRole | null>(null);

  const membersByRole = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const mem of data.members) {
      if (!m.has(mem.role_id)) m.set(mem.role_id, new Set());
      m.get(mem.role_id)!.add(mem.person_id);
    }
    return m;
  }, [data.members]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Roles by department
        </h2>
        <div className="space-y-4">
          {data.departments.map((dept) => {
            const roles = data.roles.filter((r) => r.department_id === dept.id);
            return (
              <div key={dept.id}>
                <p
                  className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: dept.color }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: dept.color }}
                  />
                  {dept.name}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {roles.map((r) => {
                    const count = membersByRole.get(r.id)?.size ?? 0;
                    return (
                      <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 text-sm text-slate-800">
                          {r.name}
                        </span>
                        <button
                          onClick={() => setEditing(r)}
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          {count} eligible
                        </button>
                        <button
                          onClick={() => setEditing(r)}
                          className="text-xs font-medium text-slate-500 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            start(async () => {
                              await deleteRole(r.id);
                              router.refresh();
                            })
                          }
                          className="text-xs font-medium text-red-500 hover:underline"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                  {roles.length === 0 && (
                    <li className="px-3 py-2 text-xs text-slate-400">
                      No roles yet.
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
          {data.departments.length === 0 && (
            <p className="text-sm text-slate-400">
              Add a department first, then create roles within it.
            </p>
          )}
        </div>
      </Card>

      <RoleEditor
        key={editing?.id ?? "new"}
        data={data}
        editing={editing}
        initialMembers={
          editing ? membersByRole.get(editing.id) ?? new Set() : new Set()
        }
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function RoleEditor({
  data,
  editing,
  initialMembers,
  onCancel,
  onSaved,
}: {
  data: SetupData;
  editing: SchedRole | null;
  initialMembers: Set<string>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialMembers),
  );
  const [q, setQ] = useState("");

  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.people
      .filter((p) => !term || gridName(p).toLowerCase().includes(term))
      .sort((a, b) => gridName(a).localeCompare(gridName(b)));
  }, [data.people, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      if (editing) {
        const memRes = await setRoleMembers(editing.id, [...selected]);
        if (!memRes.ok) {
          setError(memRes.error);
          return;
        }
      }
      onSaved();
    });
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        {editing ? "Edit role" : "New role"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <label className="block text-xs font-medium text-slate-500">
          Department
          <select
            name="department_id"
            defaultValue={editing?.department_id ?? ""}
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
          Role / title
          <input
            name="name"
            defaultValue={editing?.name ?? ""}
            required
            className={`mt-1 w-full ${inputCls}`}
            placeholder="Surgery Tech"
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

        {editing ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600">
                Eligible employees
              </p>
              <span className="text-[11px] text-slate-400">
                {selected.size} selected
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Only these employees appear when assigning this role on the grid.
            </p>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employees…"
              className={`w-full ${inputCls}`}
            />
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-100 p-1">
              {people.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="text-sm text-slate-700">{gridName(p)}</span>
                  </label>
                </li>
              ))}
              {people.length === 0 && (
                <li className="px-2 py-4 text-center text-xs text-slate-400">
                  No employees match.
                </li>
              )}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
            Add the role first, then click Edit to choose which employees are
            eligible for it.
          </p>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {editing ? "Save" : "Add"}
          </button>
          {editing && (
            <button type="button" onClick={onCancel} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
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
              <th className="py-2 pr-4 font-medium">Default location</th>
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
                    {gridName(p)}
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
                    <select
                      defaultValue={s?.default_location_id ?? ""}
                      onChange={(e) =>
                        update(p.id, { loc: e.target.value || null })
                      }
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {data.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {data.locations.map((l) => {
                        const on = (s?.eligible_location_ids ?? []).includes(
                          l.id,
                        );
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              const cur = s?.eligible_location_ids ?? [];
                              const next = on
                                ? cur.filter((x) => x !== l.id)
                                : [...cur, l.id];
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
                      })}
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
                        update(p.id, { schedulable: e.target.checked })
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
