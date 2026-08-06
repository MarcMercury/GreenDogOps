"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DB_SCHEMA } from "@/lib/supabase/config";
import {
  FAS_SHORT,
  GRID_ACTION_WIDTH,
  GRID_FLAG_COLUMNS,
  GRID_FLAG_WIDTH,
  GRID_TEXT_COLUMNS,
  alertTone,
  cardStatusStyle,
  fasTone,
  statusTone,
  withCurrent,
  type BoardColumn,
  type BoardTypeDef,
  type EditableField,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";
import {
  getTemplate,
  type CardDoc,
  type CardTemplate,
} from "@/lib/med-ops/templates";
import { PatientCard } from "./patient-card";
import {
  addBoardRow,
  deleteBoardRow,
  fetchBoardRows,
  patchBoardCard,
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

  const patchCard = useCallback(
    (rowId: string, patch: Record<string, unknown>) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, card: { ...((r.card as CardDoc | null) ?? {}), ...patch } }
            : r,
        ),
      );
      void patchBoardCard(rowId, patch).then((res) => {
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
  const template = getTemplate(board.key);
  const isCard = template.layout === "card";

  const statusOf = (r: MedicalBoardRow): string | null =>
    isCard ? ((r.card as CardDoc | null)?.status ?? null) : r.status;
  const isDone = (r: MedicalBoardRow): boolean =>
    isCard
      ? /discharg|pickup/i.test(statusOf(r) ?? "")
      : r.is_out;

  const out = rows.filter(isDone).length;
  const inProgress = rows.filter((r) => !isDone(r) && statusOf(r)).length;
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
            Nothing scheduled for this board today.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Nothing is booked for this department today. Add a walk-in below, or
            use “Sync from Agenda” if an appointment was added since this morning.
          </p>
        </div>
      ) : template.layout === "card" && template.card ? (
        <CardSummary
          rows={rows}
          tpl={template.card}
          onPatch={patchCard}
          onDelete={onDelete}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              {GRID_TEXT_COLUMNS.map((col) => (
                <col key={col.key} style={{ width: col.width }} />
              ))}
              <col style={{ width: GRID_FLAG_WIDTH }} />
              <col style={{ width: GRID_ACTION_WIDTH }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                {GRID_TEXT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    title={col.title}
                    className="border-b border-slate-200 px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="border-b border-slate-200 px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Flags
                </th>
                <th className="border-b border-slate-200" />
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
                  {GRID_TEXT_COLUMNS.map((col) => (
                    <td key={col.key} className="px-1 py-1 align-top">
                      <Cell
                        row={row}
                        col={col}
                        onCommit={commit}
                        editingRef={editingRef}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 align-top">
                    <FlagGroup row={row} onCommit={commit} />
                  </td>
                  <td className="px-1 py-1 align-top">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => launchPatient(row.id)}
                        title="Open this patient in its own window"
                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
                      >
                        ↗
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(row.id)}
                        title="Remove from board"
                        className="rounded px-1 text-[11px] text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </div>
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

/**
 * Open a patient in its own window. These get dragged onto the treatment-room
 * TVs, so they are sized generously and open without the app chrome.
 */
export function launchPatient(rowId: string) {
  window.open(
    `/patient/${rowId}`,
    `gdo-patient-${rowId}`,
    "noopener,noreferrer,width=1400,height=1000",
  );
}

/**
 * Card boards (AP, Surgery) show the day as a grid of patient tiles. Each tile
 * carries enough of the record to run the room at a glance; the full card
 * opens in place, or in its own window for the treatment-room screen.
 */
function CardSummary({
  rows,
  tpl,
  onPatch,
  onDelete,
}: {
  rows: MedicalBoardRow[];
  tpl: CardTemplate;
  onPatch: (rowId: string, patch: Record<string, unknown>) => void;
  onDelete: (rowId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => (
        <PatientTile
          key={row.id}
          row={row}
          tpl={tpl}
          open={expanded === row.id}
          onToggle={() =>
            setExpanded((cur) => (cur === row.id ? null : row.id))
          }
          onPatch={onPatch}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

/** "Pepper" Cooper, K9, 6Y, FS, Jack Russell Terrier → name + trait chips. */
function splitSignalment(
  row: MedicalBoardRow,
  card: CardDoc,
): { name: string; traits: string[] } {
  const raw = card.signalment?.trim();
  if (raw) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return { name: parts[0] ?? raw, traits: parts.slice(1) };
  }
  return {
    name:
      [row.patient, row.client_name].filter(Boolean).join(" · ") ||
      "New patient",
    traits: [row.species, row.age, row.sex, row.breed].filter(
      (v): v is string => Boolean(v),
    ),
  };
}

/** "Friendly · *CARDIO,*AP REQUIRED" → one chip per caution. */
function alertChips(text: string): string[] {
  return text
    .split(/[·,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function PatientTile({
  row,
  tpl,
  open,
  onToggle,
  onPatch,
  onDelete,
}: {
  row: MedicalBoardRow;
  tpl: CardTemplate;
  open: boolean;
  onToggle: () => void;
  onPatch: (rowId: string, patch: Record<string, unknown>) => void;
  onDelete: (rowId: string) => void;
}) {
  const card = (row.card as CardDoc | null) ?? {};
  const status = card.status ?? "";
  const tone = cardStatusStyle(status);
  const step = tpl.statusOptions.indexOf(status);
  const { name, traits } = splitSignalment(row, card);
  const alerts = alertChips(card.alerts ?? row.cautions ?? "");
  const listItems = (card.list ?? []).filter((l) => l.text.trim());
  const meds = (card.meds ?? []).filter((m) => m.drug.trim());
  const medsGiven = meds.filter((m) => m.given || m.given2).length;
  const prepDone = tpl.checklist.filter((c) => card.checklist?.[c.key]).length;
  const noteText = tpl.notes
    .map((n) => card.notes?.[n.key]?.trim())
    .find(Boolean);
  const weight = card.weight_kg?.trim() || row.weight_kg?.trim() || "";

  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition ${
        open
          ? "border-emerald-300 ring-1 ring-emerald-200 md:col-span-2 2xl:col-span-3"
          : "border-slate-200 hover:shadow-md"
      } ${/discharg/i.test(status) ? "opacity-70" : ""}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1.5 ${tone.bar}`}
      />

      <header
        className={`flex items-start gap-2 border-b border-slate-100 py-2.5 pl-4 pr-2.5 ${tone.header}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-700 ring-1 ring-slate-200">
              {row.appt_time || "—:—"}
            </span>
            <h3 className="truncate text-sm font-bold text-slate-900">{name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {traits.length ? (
              traits.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded bg-white/80 px-1.5 py-px text-[10px] font-medium text-slate-600 ring-1 ring-slate-200"
                >
                  {t}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-slate-400">No signalment</span>
            )}
          </div>
        </div>
        <select
          value={status}
          onChange={(e) => onPatch(row.id, { status: e.target.value })}
          aria-label="Patient status"
          className={`shrink-0 rounded-lg border-0 px-2 py-1 text-[11px] font-semibold shadow-sm outline-none ${tone.chip}`}
        >
          <option value="" className="bg-white text-slate-700">
            Status…
          </option>
          {tpl.statusOptions.map((s) => (
            <option key={s} value={s} className="bg-white text-slate-700">
              {s}
            </option>
          ))}
        </select>
      </header>

      {alerts.length ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 py-1.5 pl-4 pr-2.5">
          {alerts.map((a, i) => (
            <span
              key={`${a}-${i}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${alertTone(a)}`}
            >
              {a}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 py-2.5 pl-4 pr-2.5">
        <Metric label="WT (kg)" value={weight} />
        <Metric
          label="Bloodwork"
          value={card.bw_type ?? ""}
          tone={card.bw_done ? "text-emerald-700" : undefined}
          suffix={card.bw_done ? "✓" : undefined}
        />
        <Metric label="IVC" value={card.ivc ?? ""} />
        {tpl.statusFields.map((f) => (
          <Metric
            key={f.key}
            label={f.label}
            value={card.fields?.[f.key] ?? ""}
          />
        ))}
      </div>

      <div className="border-t border-slate-100 py-2 pl-4 pr-2.5">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
          {tpl.listLabel}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {listItems.length ? (
            listItems.map((item, i) => (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${
                  item.done
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-50 text-slate-700 ring-slate-200"
                }`}
              >
                {item.done ? "✓ " : ""}
                {item.text}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-slate-300">None recorded</span>
          )}
        </div>
      </div>

      {noteText ? (
        <p className="line-clamp-2 border-t border-slate-100 py-2 pl-4 pr-2.5 text-[11px] leading-snug text-slate-500">
          <span className="font-semibold uppercase tracking-wider text-slate-400">
            Notes ·{" "}
          </span>
          {noteText}
        </p>
      ) : null}

      <div className="mt-auto space-y-2 border-t border-slate-100 pb-2.5 pt-2 pl-4 pr-2.5">
        <div
          className="flex gap-0.5"
          role="img"
          aria-label={`Stage: ${status || "not started"}`}
        >
          {tpl.statusOptions.map((s, i) => (
            <span
              key={s}
              title={s}
              className={`h-1.5 flex-1 rounded-full transition ${
                i <= step ? tone.bar : "bg-slate-200"
              }`}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Counter label="Prep" done={prepDone} total={tpl.checklist.length} />
          <Counter label="Meds" done={medsGiven} total={meds.length} />
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {open ? "Hide details" : "Details"}
              <span
                className={`ml-1 inline-block transition-transform ${open ? "" : "-rotate-90"}`}
              >
                ⌄
              </span>
            </button>
            <button
              type="button"
              onClick={() => launchPatient(row.id)}
              title="Open this patient in its own window for the treatment-room screen"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
            >
              Launch ↗
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-slate-200 bg-slate-50/70 p-2">
          <PatientCard
            row={row}
            tpl={tpl}
            onPatch={onPatch}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </article>
  );
}

/** One labelled value in a tile's stat strip. */
function Metric({
  label,
  value,
  tone,
  suffix,
}: {
  label: string;
  value: string;
  tone?: string;
  suffix?: string;
}) {
  const text = value.trim();
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div
        className={`truncate text-[13px] font-semibold ${
          text ? (tone ?? "text-slate-800") : "text-slate-300"
        }`}
        title={text || undefined}
      >
        {text || "—"}
        {text && suffix ? ` ${suffix}` : ""}
      </div>
    </div>
  );
}

/** Progress chip — grey untouched, blue in flight, green complete. */
function Counter({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  if (!total) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        done === total
          ? "bg-emerald-50 text-emerald-700"
          : done
            ? "bg-sky-50 text-sky-700"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {label} {done}/{total}
    </span>
  );
}

/** The yes/no columns as one compact block of toggle chips. */
function FlagGroup({
  row,
  onCommit,
}: {
  row: MedicalBoardRow;
  onCommit: (rowId: string, field: EditableField, value: CellValue) => void;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {GRID_FLAG_COLUMNS.map((col) => {
        const on = Boolean(row[col.key]);
        return (
          <button
            key={col.key}
            type="button"
            title={`${col.label}${col.title ? ` — ${col.title}` : ""}`}
            aria-pressed={on}
            onClick={() => onCommit(row.id, col.key, !on)}
            className={`rounded px-1 py-0.5 text-[9px] font-semibold leading-tight transition ${
              on
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            }`}
          >
            {col.flagLabel}
          </button>
        );
      })}
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
  const text = (cellValue(row, col.key) as string | null) ?? "";

  // Enumerated columns are selects, so a long label never needs a wide cell.
  if (col.kind === "select" && col.options) {
    const tone = col.key === "fas_score" ? fasTone(text) : statusTone(text);
    return (
      <select
        value={text}
        onChange={(e) => onCommit(row.id, col.key, e.target.value)}
        className={`w-full rounded border border-transparent px-0.5 py-1 text-[11px] transition hover:border-slate-200 focus:border-emerald-400 focus:outline-none ${tone}`}
      >
        <option value="">—</option>
        {withCurrent(col.options, text).map((o) => (
          <option key={o} value={o}>
            {FAS_SHORT[o] ?? o}
          </option>
        ))}
      </select>
    );
  }

  const onFocus = () => {
    editingRef.current = { rowId: row.id, field: col.key };
  };
  const onBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    editingRef.current = null;
    if (e.target.value !== text) onCommit(row.id, col.key, e.target.value);
  };
  const cls =
    "w-full rounded border border-transparent px-1 py-1 text-[11px] transition hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400";

  // Long free text wraps rather than being clipped by the column width.
  if (col.wrap) {
    return (
      <textarea
        key={text}
        rows={2}
        defaultValue={text}
        title={col.key === "services" ? row.appt_description ?? undefined : undefined}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`${cls} resize-y leading-snug`}
      />
    );
  }

  return (
    <input
      // Remount when the stored value changes so a teammate's edit shows here.
      // The focused cell is excluded from remote merges, so this never fires
      // mid-keystroke.
      key={text}
      type="text"
      defaultValue={text}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cls}
    />
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
