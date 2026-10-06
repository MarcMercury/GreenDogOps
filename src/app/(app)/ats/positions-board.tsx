"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  POSITION_PRIORITY_BADGE,
  POSITION_PRIORITY_LABELS,
  POSITION_STATUS_BADGE,
  POSITION_STATUS_LABELS,
  bucketForStage,
  type CandidateRow,
  type PositionRow,
} from "@/lib/ats/types";
import { deletePosition, savePosition, setPositionStatus } from "./actions";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelCls = "text-sm font-medium text-slate-700";

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };
const STATUS_ORDER: Record<string, number> = { open: 0, on_hold: 1, filled: 2, closed: 3 };

/**
 * Open positions / hiring needs — what the team tracked in the Slack canvas
 * ("we need another Van Nuys CSR", "MyPet truck tech top priority"). Each row
 * counts the active candidates linked to it.
 */
export function PositionsBoard({
  positions,
  rows,
  roles,
  locations,
  canEdit,
  isAdmin,
}: {
  positions: PositionRow[];
  rows: CandidateRow[];
  roles: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<PositionRow | "new" | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const activeByPosition = new Map<string, number>();
  for (const r of rows) {
    const pid = r.person_recruiting?.target_position_id;
    if (!pid) continue;
    if (bucketForStage(r.person_recruiting?.stage ?? null) !== "active") continue;
    activeByPosition.set(pid, (activeByPosition.get(pid) ?? 0) + 1);
  }

  const visible = positions
    .filter((p) => showClosed || p.status === "open" || p.status === "on_hold")
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        a.title.localeCompare(b.title),
    );
  const openCount = positions.filter((p) => p.status === "open").length;
  const openings = positions
    .filter((p) => p.status === "open")
    .reduce((n, p) => n + p.openings, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{openCount}</span> open position
          {openCount === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-slate-900">{openings}</span> opening
          {openings === 1 ? "" : "s"} to fill
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Show filled / closed
          </label>
          {canEdit && (
            <button
              onClick={() => setEditing("new")}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              + Position
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No open positions. {canEdit && "Add one to track what you're hiring for."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Position</th>
                <th className="px-4 py-2.5">Location</th>
                <th className="px-4 py-2.5">Priority</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-center">Openings</th>
                <th className="px-4 py-2.5 text-center">Active candidates</th>
                <th className="px-4 py-2.5">Notes</th>
                {canEdit && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.title}</td>
                  <td className="px-4 py-3 text-slate-700">{p.location ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${POSITION_PRIORITY_BADGE[p.priority] ?? ""}`}
                    >
                      {POSITION_PRIORITY_LABELS[p.priority] ?? p.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusSelect position={p} canEdit={canEdit} />
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{p.openings}</td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {activeByPosition.get(p.id) ?? 0}
                  </td>
                  <td className="max-w-xs whitespace-pre-wrap px-4 py-3 text-slate-600">
                    {p.notes ?? ""}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PositionDialog
          position={editing === "new" ? null : editing}
          roles={roles}
          locations={locations}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StatusSelect({ position, canEdit }: { position: PositionRow; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(position.status);
  const badge = POSITION_STATUS_BADGE[value] ?? "";
  if (!canEdit) {
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
        {POSITION_STATUS_LABELS[value] ?? value}
      </span>
    );
  }
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        startTransition(async () => {
          const res = await setPositionStatus(position.id, next);
          if (!res.ok) {
            setValue(prev);
            alert(res.error);
          }
        });
      }}
      className={`cursor-pointer rounded-full border-0 px-2 py-0.5 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 ${badge}`}
    >
      {Object.entries(POSITION_STATUS_LABELS).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function PositionDialog({
  position,
  roles,
  locations,
  isAdmin,
  onClose,
}: {
  position: PositionRow | null;
  roles: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(savePosition, null);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  const [locationIds, setLocationIds] = useState<Set<string>>(new Set());
  const [openings, setOpenings] = useState<number>(position?.openings ?? 1);
  const selectedRole = roles.find((role) => role.name === position?.title);
  const selectedLocation = locations.find(
    (location) => location.name === position?.location,
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isNew = !position;
  const combos = roleIds.size * locationIds.size;
  const canSubmit = !pending && (!isNew || combos > 0);
  const error = state && !state.ok ? state.error : deleteError;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-dialog-title"
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          {position && <input type="hidden" name="position_id" value={position.id} />}

          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
            <div>
              <h2 id="position-dialog-title" className="text-lg font-semibold text-slate-900">
                {position ? "Edit position" : "New position"}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {position
                  ? "Update the role, clinic, and hiring details."
                  : "Pick the roles and clinics you're hiring for."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            {position ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Position">
                  <select
                    name="role_id"
                    defaultValue={selectedRole?.id ?? "__current_role__"}
                    required
                    className={`${inputCls} w-full`}
                  >
                    {!selectedRole && (
                      <option value="__current_role__">
                        {position.title} (current; not in active roles)
                      </option>
                    )}
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Clinic location">
                  <select
                    name="location_id"
                    defaultValue={
                      selectedLocation?.id ??
                      (position.location ? "__current_location__" : "")
                    }
                    className={`${inputCls} w-full`}
                  >
                    <option value="">— None —</option>
                    {!selectedLocation && position.location && (
                      <option value="__current_location__">
                        {position.location} (current; not an active clinic)
                      </option>
                    )}
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : (
              <>
                <ChipGroup
                  label="Roles"
                  name="role_ids"
                  options={roles}
                  selected={roleIds}
                  onChange={setRoleIds}
                  scroll
                />
                <ChipGroup
                  label="Clinics"
                  name="location_ids"
                  options={locations}
                  selected={locationIds}
                  onChange={setLocationIds}
                />
                <div
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
                    combos > 0
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  {combos > 0 ? (
                    <span>
                      Creates <strong className="font-semibold">{combos}</strong> position
                      {combos === 1 ? "" : "s"}
                      {combos > 1 && (
                        <span className="text-emerald-700">
                          {" "}
                          ({roleIds.size} role{roleIds.size === 1 ? "" : "s"} ×{" "}
                          {locationIds.size} clinic{locationIds.size === 1 ? "" : "s"})
                        </span>
                      )}
                      , each with {openings} opening{openings === 1 ? "" : "s"}.
                    </span>
                  ) : (
                    <span>Select at least one role and one clinic.</span>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Priority">
                <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1">
                  {Object.entries(POSITION_PRIORITY_LABELS).map(([v, l]) => (
                    <label key={v} className="cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        value={v}
                        defaultChecked={(position?.priority ?? "normal") === v}
                        className="peer sr-only"
                      />
                      <span className="block rounded-md px-2 py-1.5 text-center text-sm font-medium text-slate-500 transition hover:text-slate-700 peer-checked:bg-white peer-checked:text-slate-900 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500">
                        {l}
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Status">
                <select
                  name="status"
                  defaultValue={position?.status ?? "open"}
                  className={`${inputCls} w-full`}
                >
                  {Object.entries(POSITION_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={isNew ? "Openings (each)" : "Openings"}>
                <div className="flex h-[38px] items-stretch overflow-hidden rounded-lg border border-slate-300 shadow-sm focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
                  <button
                    type="button"
                    aria-label="Decrease openings"
                    onClick={() => setOpenings((n) => Math.max(1, n - 1))}
                    disabled={openings <= 1}
                    className="w-10 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    name="openings"
                    type="number"
                    min={1}
                    value={openings}
                    onChange={(e) => setOpenings(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full min-w-0 border-x border-slate-200 text-center text-sm tabular-nums [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label="Increase openings"
                    onClick={() => setOpenings((n) => n + 1)}
                    className="w-10 text-lg text-slate-500 transition hover:bg-slate-50"
                  >
                    +
                  </button>
                </div>
              </Field>
            </div>

            <Field label="Notes" hint="Optional">
              <textarea
                name="notes"
                rows={3}
                defaultValue={position?.notes ?? ""}
                placeholder="e.g. Lesly moving remote — last in-house day Sept 17"
                className={`${inputCls} w-full resize-y`}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
            <div>
              {position && isAdmin && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    if (!confirm(`Delete ${position.title}? Linked candidates keep their record.`)) return;
                    setDeleteError(null);
                    startDelete(async () => {
                      const res = await deletePosition(position.id);
                      if (res.ok) onClose();
                      else setDeleteError(res.error);
                    });
                  }}
                  className="rounded-lg px-2 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending
                  ? "Saving…"
                  : isNew && combos > 1
                    ? `Create ${combos} positions`
                    : isNew
                      ? "Create position"
                      : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className={labelCls}>{label}</span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipGroup({
  label,
  name,
  options,
  selected,
  onChange,
  scroll,
}: {
  label: string;
  name: string;
  options: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  scroll?: boolean;
}) {
  const allSelected = options.length > 0 && selected.size === options.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <fieldset>
      <div className="mb-2 flex items-center justify-between">
        <legend className={labelCls}>
          {label}
          {selected.size > 0 && (
            <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              {selected.size} selected
            </span>
          )}
        </legend>
        {options.length > 1 && (
          <button
            type="button"
            onClick={() => onChange(allSelected ? new Set() : new Set(options.map((o) => o.id)))}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
          None available.
        </p>
      ) : (
        <div
          className={`flex flex-wrap gap-2 ${
            scroll ? "max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2" : ""
          }`}
        >
          {options.map((o) => {
            const on = selected.has(o.id);
            return (
              <label key={o.id} className="cursor-pointer">
                <input
                  type="checkbox"
                  name={name}
                  value={o.id}
                  checked={on}
                  onChange={() => toggle(o.id)}
                  className="peer sr-only"
                />
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-1 ${
                    on
                      ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {on && (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="-ml-0.5 h-3.5 w-3.5">
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {o.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
