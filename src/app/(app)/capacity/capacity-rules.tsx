"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAY_SHORT } from "@/lib/schedule/types";
import { STAFF_CATEGORIES } from "@/lib/planning/resolve";
import type { PlanningCapacityRule } from "@/lib/planning/types";
import {
  createCapacityRule,
  updateCapacityRule,
  deleteCapacityRule,
} from "./actions";

interface AreaLite {
  id: string;
  name: string;
  color: string;
}
interface LocLite {
  id: string;
  name: string | null;
  short_code: string | null;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Editable draft for the rule form. Blank count = wildcard. */
interface Draft {
  id?: string;
  location_id: string;
  label: string;
  weekdays: number[];
  dvm_count: string;
  tech_count: string;
  lead_count: string;
  dental_count: string;
  da_count: string;
  float_count: string;
  appointment_capacity: string;
}

function emptyDraft(): Draft {
  return {
    location_id: "",
    label: "",
    weekdays: [],
    dvm_count: "",
    tech_count: "",
    lead_count: "",
    dental_count: "",
    da_count: "",
    float_count: "",
    appointment_capacity: "",
  };
}

function draftFromRule(r: PlanningCapacityRule): Draft {
  const s = (n: number | null) => (n != null ? String(n) : "");
  return {
    id: r.id,
    location_id: r.location_id ?? "",
    label: r.label ?? "",
    weekdays: [...r.weekdays],
    dvm_count: s(r.dvm_count),
    tech_count: s(r.tech_count),
    lead_count: s(r.lead_count),
    dental_count: s(r.dental_count),
    da_count: s(r.da_count),
    float_count: s(r.float_count),
    appointment_capacity: String(r.appointment_capacity),
  };
}

const COUNT_KEY = (k: string) => `${k}_count` as keyof Draft;

/**
 * Daily Capacity management panel. Pick a schedule area (AP, NAD, Clinic /
 * Wellness, Surgery …) and define the condition → appointment-count rules that
 * drive that area's capacity: "if this staffing situation exists, then this many
 * appointments are available." These rules feed the Daily Capacity grid above
 * and the planning-guide assumptions.
 */
export function CapacityRulesManager({
  areas,
  locations,
  rules,
  canEdit,
}: {
  areas: AreaLite[];
  locations: LocLite[];
  rules: PlanningCapacityRule[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const area = areas.find((a) => a.id === areaId) ?? null;
  const areaRules = useMemo(
    () =>
      rules
        .filter((r) => r.department_id === areaId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [rules, areaId],
  );
  const locName = (id: string | null) => {
    if (!id) return "Any location";
    const l = locations.find((x) => x.id === id);
    return l ? l.short_code ?? l.name ?? "Location" : "Location";
  };

  if (areas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        No planning areas are enabled yet. Enable a department&apos;s &ldquo;show
        in planning&rdquo; flag to manage its capacity rules here.
      </div>
    );
  }

  const submit = () => {
    if (!draft || !area) return;
    setError(null);
    const fd = new FormData();
    if (draft.id) fd.set("id", draft.id);
    fd.set("department_id", area.id);
    if (draft.location_id) fd.set("location_id", draft.location_id);
    if (draft.label) fd.set("label", draft.label);
    for (const d of draft.weekdays) fd.append("weekdays", String(d));
    for (const { key } of STAFF_CATEGORIES) {
      const v = draft[COUNT_KEY(key)] as string;
      if (v !== "") fd.set(`${key}_count`, v);
    }
    fd.set("appointment_capacity", draft.appointment_capacity || "0");
    start(async () => {
      const res = draft.id
        ? await updateCapacityRule(fd)
        : await createCapacityRule(fd);
      if (res.ok) {
        setDraft(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const remove = (id: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    start(async () => {
      const res = await deleteCapacityRule(fd);
      if (res.ok) {
        setDraft(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">
            Capacity rules
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Set how many appointments each area can render for a given staffing
            situation. These conditions drive the capacity shown above.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Area
          <select
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setDraft(null);
              setError(null);
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {/* Existing rules for the selected area */}
      <div className="mt-3 space-y-1.5">
        {areaRules.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
            No capacity rules for {area?.name} yet.
          </p>
        ) : (
          areaRules.map((r) => {
            const conds = STAFF_CATEGORIES.filter(
              ({ key }) => r[`${key}_count` as keyof PlanningCapacityRule] != null,
            ).map(
              ({ key, label }) =>
                `${label} ${r[`${key}_count` as keyof PlanningCapacityRule]}`,
            );
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
              >
                <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                  {r.appointment_capacity} appt
                </span>
                <span className="text-xs text-slate-600">
                  {conds.length ? conds.join(" · ") : "Any staffing"}
                </span>
                <span className="text-[11px] text-slate-400">
                  {locName(r.location_id)}
                  {" · "}
                  {r.weekdays.length
                    ? r.weekdays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => DAY_SHORT[d])
                        .join(", ")
                    : "Any day"}
                </span>
                {r.label ? (
                  <span className="text-[11px] italic text-slate-400">
                    {r.label}
                  </span>
                ) : null}
                {canEdit ? (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(draftFromRule(r));
                        setError(null);
                      }}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(r.id)}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Add / edit form */}
      {canEdit ? (
        draft ? (
          <RuleEditor
            draft={draft}
            setDraft={setDraft}
            locations={locations}
            pending={pending}
            onCancel={() => {
              setDraft(null);
              setError(null);
            }}
            onSubmit={submit}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(emptyDraft());
              setError(null);
            }}
            className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            + Add capacity rule
          </button>
        )
      ) : null}
    </div>
  );
}

function RuleEditor({
  draft,
  setDraft,
  locations,
  pending,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  locations: LocLite[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const toggleDay = (d: number) =>
    set({
      weekdays: draft.weekdays.includes(d)
        ? draft.weekdays.filter((x) => x !== d)
        : [...draft.weekdays, d],
    });

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">
        {draft.id ? "Edit rule" : "New rule"} — if this situation exists…
      </p>

      {/* Staffing condition */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STAFF_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-0.5 text-[11px] text-slate-500">
            {label}
            <input
              type="number"
              min={0}
              max={20}
              placeholder="any"
              value={draft[COUNT_KEY(key)] as string}
              onChange={(e) => set({ [COUNT_KEY(key)]: e.target.value } as Partial<Draft>)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        ))}
      </div>

      {/* Location + weekdays */}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
          Location
          <select
            value={draft.location_id}
            onChange={(e) => set({ location_id: e.target.value })}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Any location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.short_code ?? l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-0.5 text-[11px] text-slate-500">
          Days
          <div className="flex gap-1">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`rounded px-1.5 py-1 text-[11px] font-semibold ${
                  draft.weekdays.includes(d)
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-500 border border-slate-300"
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Outcome */}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-slate-600">
          …then this many appointments
          <input
            type="number"
            min={0}
            max={500}
            value={draft.appointment_capacity}
            onChange={(e) => set({ appointment_capacity: e.target.value })}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-slate-500">
          Note (optional)
          <input
            type="text"
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="e.g. 2-DVM heavy day"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onSubmit}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
