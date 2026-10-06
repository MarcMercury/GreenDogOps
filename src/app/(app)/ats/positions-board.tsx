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
const labelCls = "text-xs font-medium text-slate-500";

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
  const selectedRole = roles.find((role) => role.name === position?.title);
  const selectedLocation = locations.find(
    (location) => location.name === position?.location,
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form action={formAction}>
          {position && <input type="hidden" name="position_id" value={position.id} />}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-900">
              {position ? "Edit Position" : "New Position"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {(state && !state.ok) || deleteError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
                {state && !state.ok ? state.error : deleteError}
              </p>
            ) : null}
            {position ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Position</span>
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
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Clinic location</span>
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
                </label>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Positions</span>
                  <select
                    name="role_ids"
                    multiple
                    required
                    size={Math.min(roles.length, 5) || 2}
                    className={`${inputCls} w-full`}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-400">
                    Select one or more system roles. Use Ctrl-click (Cmd-click on Mac) for multiple.
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Clinic locations</span>
                  <select
                    name="location_ids"
                    multiple
                    required
                    size={Math.min(locations.length, 5) || 2}
                    className={`${inputCls} w-full`}
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-400">
                    Each role/clinic combination becomes a separate position, with the openings count applied to each. Use Ctrl-click (Cmd-click on Mac) for multiple.
                  </span>
                </label>
              </>
            )}
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Priority</span>
              <select
                name="priority"
                defaultValue={position?.priority ?? "normal"}
                className={inputCls}
              >
                {Object.entries(POSITION_PRIORITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Status</span>
              <select
                name="status"
                defaultValue={position?.status ?? "open"}
                className={inputCls}
              >
                {Object.entries(POSITION_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Openings</span>
              <input
                name="openings"
                type="number"
                min={1}
                defaultValue={position?.openings ?? 1}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Notes</span>
              <textarea
                name="notes"
                rows={3}
                defaultValue={position?.notes ?? ""}
                placeholder="e.g. Lesly moving remote — last in-house day Sept 17"
                className={inputCls}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
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
                  className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
