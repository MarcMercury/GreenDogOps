"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DB_SCHEMA } from "@/lib/supabase/config";
import {
  BOARD_COLUMNS,
  fasTone,
  statusTone,
  type BoardColumn,
  type BoardTypeDef,
  type EditableField,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";
import {
  addBoardRow,
  deleteBoardRow,
  fetchBoardRows,
  syncBoardFromAgenda,
  updateBoardCell,
} from "../../actions";

/** How often to re-poll as a safety net when Realtime can't connect. */
const POLL_MS = 20000;

type CellValue = string | boolean | null;

function cellValue(row: MedicalBoardRow, key: EditableField): CellValue {
  return row[key] as CellValue;
}

export function MedicalBoard({
  board,
  locationId,
  locationSlug,
  date,
  initialRows,
}: {
  board: BoardTypeDef;
  locationId: string;
  locationSlug: string;
  date: string;
  initialRows: MedicalBoardRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MedicalBoardRow[]>(initialRows);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // The cell the user is typing in must never be clobbered by an incoming
  // remote refresh, or their keystrokes would be lost mid-edit.
  const editingRef = useRef<{ rowId: string; field: EditableField } | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchBoardRows(locationId, date, board.key);
    setRows((prev) =>
      next.map((remote) => {
        const editing = editingRef.current;
        if (editing && editing.rowId === remote.id) {
          const local = prev.find((p) => p.id === remote.id);
          if (local) {
            return { ...remote, [editing.field]: local[editing.field] };
          }
        }
        return remote;
      }),
    );
  }, [locationId, date, board.key]);

  // Phase 4 — live sync. Realtime pushes every edit to all open boards; the
  // interval is a fallback for networks where the websocket can't connect.
  useEffect(() => {
    const supabase = createClient();
    const boardKey = `${locationId}:${date}:${board.key}`;
    const channel = supabase
      .channel(`medical-board:${boardKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: DB_SCHEMA,
          table: "medical_board_row",
          filter: `board_key=eq.${boardKey}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [locationId, date, board.key, refresh]);

  const commit = useCallback(
    (rowId: string, field: EditableField, value: CellValue) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)),
      );
      void updateBoardCell(rowId, field, value).then((res) => {
        if (!res.ok) {
          setNote(res.error);
          void refresh();
        }
      });
    },
    [refresh],
  );

  const onSync = () => {
    startTransition(async () => {
      const res = await syncBoardFromAgenda(locationId, date, board.key);
      setNote(
        res.ok
          ? res.data === 0
            ? "Board is already up to date with the Agenda."
            : `Added ${res.data} appointment${res.data === 1 ? "" : "s"} from the Agenda.`
          : res.error,
      );
      await refresh();
    });
  };

  const onAdd = () => {
    startTransition(async () => {
      const res = await addBoardRow(locationId, date, board.key);
      if (!res.ok) setNote(res.error);
      await refresh();
    });
  };

  const onDelete = (rowId: string) => {
    startTransition(async () => {
      const res = await deleteBoardRow(rowId);
      if (!res.ok) setNote(res.error);
      await refresh();
    });
  };

  const goToDate = (next: string) => {
    router.push(
      `/med-ops/medical-boards/${locationSlug}/${board.key}?date=${next}`,
    );
  };

  const total = rows.length;
  const out = rows.filter((r) => r.is_out).length;
  const inProgress = rows.filter((r) => !r.is_out && r.status).length;
  const waiting = total - out - inProgress;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateNav date={date} onChange={goToDate} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <LiveBadge live={live} />
          <button
            type="button"
            onClick={onSync}
            disabled={pending}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Sync from Agenda
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            + Add patient
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Stat label="Patients" value={total} tone="bg-slate-100 text-slate-700" />
        <Stat label="Waiting" value={waiting} tone="bg-indigo-50 text-indigo-700" />
        <Stat label="In progress" value={inProgress} tone="bg-sky-50 text-sky-700" />
        <Stat label="Out" value={out} tone="bg-emerald-50 text-emerald-700" />
      </div>

      {note ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span>{note}</span>
          <button
            type="button"
            onClick={() => setNote(null)}
            className="text-slate-400 transition hover:text-slate-600"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            No patients on this board yet.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Use “Sync from Agenda” to pull the day&apos;s booked appointments, or
            add a walk-in manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                {BOARD_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    title={col.title}
                    className={`${col.width} whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500`}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="w-10 border-b border-slate-200" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 transition hover:bg-slate-50/60 ${
                    row.is_out ? "opacity-55" : ""
                  }`}
                >
                  {BOARD_COLUMNS.map((col) => (
                    <td key={col.key} className={`${col.width} px-1 py-1 align-top`}>
                      <Cell
                        row={row}
                        col={col}
                        onCommit={commit}
                        editingRef={editingRef}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 align-top">
                    <button
                      type="button"
                      onClick={() => onDelete(row.id)}
                      title="Remove from board"
                      className="rounded px-1.5 py-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({
  row,
  col,
  onCommit,
  editingRef,
}: {
  row: MedicalBoardRow;
  col: BoardColumn;
  onCommit: (rowId: string, field: EditableField, value: CellValue) => void;
  editingRef: React.RefObject<{ rowId: string; field: EditableField } | null>;
}) {
  const value = cellValue(row, col.key);

  if (col.kind === "check") {
    return (
      <div className="flex justify-center pt-1">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onCommit(row.id, col.key, e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          aria-label={col.label}
        />
      </div>
    );
  }

  const tone =
    col.key === "fas_score"
      ? fasTone(value as string | null)
      : col.key === "status"
        ? statusTone(value as string | null)
        : "";

  const listId = col.options ? `opt-${col.key}` : undefined;

  return (
    <>
      <input
        // Remount when the stored value changes so edits made by teammates
        // appear here. The cell being typed in is excluded from remote merges
        // (see refresh), so this never fires mid-keystroke.
        key={String(value ?? "")}
        type="text"
        defaultValue={(value as string | null) ?? ""}
        list={listId}
        title={col.key === "services" ? row.appt_description ?? undefined : undefined}
        onFocus={() => {
          editingRef.current = { rowId: row.id, field: col.key };
        }}
        onBlur={(e) => {
          editingRef.current = null;
          const next = e.target.value;
          if (next !== ((value as string | null) ?? "")) {
            onCommit(row.id, col.key, next);
          }
        }}
        className={`w-full rounded border border-transparent px-1.5 py-1 text-xs transition hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400 ${tone}`}
      />
      {col.options ? (
        <datalist id={listId}>
          {col.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

function DateNav({
  date,
  onChange,
}: {
  date: string;
  onChange: (next: string) => void;
}) {
  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().slice(0, 10));
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
        aria-label="Previous day"
      >
        ‹
      </button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => shift(1)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
        aria-label="Next day"
      >
        ›
      </button>
    </div>
  );
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      title={live ? "Live — updates appear instantly" : "Reconnecting; refreshing periodically"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`}
        aria-hidden
      />
      {live ? "Live" : "Syncing"}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tone}`}>
      {label}: <span className="font-bold">{value}</span>
    </span>
  );
}
