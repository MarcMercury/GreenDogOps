"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DB_SCHEMA } from "@/lib/supabase/config";
import {
  BOARD_COLUMNS,
  cardStatusStyle,
  fasTone,
  signalmentOf,
  statusTone,
  type BoardTypeDef,
  type EditableField,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";
import { getTemplate, type CardDoc } from "@/lib/med-ops/templates";
import {
  fetchBoardRow,
  patchBoardCard,
  updateBoardCell,
} from "../../../(app)/med-ops/medical-boards/actions";
import { PatientCard } from "../../../(app)/med-ops/medical-boards/[location]/[board]/patient-card";

const POLL_MS = 15000;

/**
 * A single patient's record for one day, on its own window so it can be dragged
 * onto the treatment-room TV. Edits here and edits on the board are the same
 * rows, and both subscribe to the same Realtime channel, so the two stay in
 * step in both directions.
 */
export function PatientWindow({
  row: initialRow,
  board,
  locationName,
}: {
  row: MedicalBoardRow;
  board: BoardTypeDef;
  locationName: string;
}) {
  const [row, setRow] = useState(initialRow);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef(false);
  const template = getTemplate(board.key);

  const refresh = useCallback(async () => {
    if (editingRef.current) return;
    const next = await fetchBoardRow(initialRow.id);
    if (next) setRow(next);
  }, [initialRow.id]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`patient-window:${initialRow.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: DB_SCHEMA,
          table: "medical_board_row",
          filter: `id=eq.${initialRow.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [initialRow.id, refresh]);

  const patchCard = useCallback(
    (rowId: string, patch: Record<string, unknown>) => {
      setRow((prev) => ({
        ...prev,
        card: { ...(prev.card ?? {}), ...patch },
      }));
      setSaving(true);
      void patchBoardCard(rowId, patch).finally(() => setSaving(false));
    },
    [],
  );

  const commitCell = useCallback(
    (field: EditableField, value: string | boolean | null) => {
      setRow((prev) => ({ ...prev, [field]: value }));
      setSaving(true);
      void updateBoardCell(row.id, field, value).finally(() => setSaving(false));
    },
    [row.id],
  );

  const title = row.patient ?? "Patient";
  const card = (row.card ?? {}) as CardDoc;
  const statusOptions = template.card?.statusOptions ?? [];
  // The card's own alert line and the ezyVet flags say the same thing, so the
  // window shows one editable copy instead of repeating it inside the card.
  const alerts =
    card.alerts ??
    [row.cautions, row.master_problems].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-[1600px] space-y-2 p-3">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-lg text-xl"
          style={{ backgroundColor: `${board.accent}1a`, color: board.accent }}
          aria-hidden
        >
          {board.icon}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="truncate text-xs text-slate-500">
            {[signalmentOf(row), row.client_name, locationName, board.label]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {statusOptions.length ? (
            <select
              value={card.status ?? ""}
              onChange={(e) => patchCard(row.id, { status: e.target.value })}
              className={`rounded-lg border-0 px-2.5 py-1 text-sm font-semibold shadow-sm outline-none ${cardStatusStyle(card.status ?? null).chip}`}
            >
              <option value="" className="bg-white text-slate-700">
                Status…
              </option>
              {statusOptions.map((s) => (
                <option key={s} value={s} className="bg-white text-slate-700">
                  {s}
                </option>
              ))}
            </select>
          ) : null}
          {row.appt_time ? (
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700">
              {row.appt_time}
            </span>
          ) : null}
          <span
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              saving ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {saving ? "Saving…" : "Synced"}
          </span>
        </div>
      </header>

      {alerts ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            Alerts
          </span>
          <input
            key={alerts}
            type="text"
            defaultValue={alerts}
            onFocus={() => {
              editingRef.current = true;
            }}
            onBlur={(e) => {
              editingRef.current = false;
              if (e.target.value !== alerts) {
                patchCard(row.id, { alerts: e.target.value });
              }
            }}
            className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-amber-900 outline-none focus:border-amber-400 focus:bg-white"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Fact label="Species" value={row.species} />
        <Fact label="Breed" value={row.breed} />
        <Fact label="Sex / Age" value={[row.sex, row.age].filter(Boolean).join(" · ")} />
        <Fact label="Last visit" value={row.last_visit} />
        <Fact label="Owner" value={row.client_name} />
        <Fact label="Phone" value={row.owner_phone} />
        <Fact label="Email" value={row.owner_email} />
        <Fact label="Insurance" value={row.insurance} />
      </div>

      {template.layout === "card" && template.card ? (
        <div
          // Scales the card up for TV viewing without changing its layout.
          className="[&_input]:text-[13px] [&_textarea]:text-[13px]"
        >
          <PatientCard
            row={row}
            tpl={template.card}
            variant="window"
            onPatch={patchCard}
            onDelete={() => window.close()}
          />
        </div>
      ) : (
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
          {BOARD_COLUMNS.map((col) => {
            const value = row[col.key] as string | boolean | null;
            if (col.kind === "check") {
              return (
                <label
                  key={col.key}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => commitCell(col.key, e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-emerald-600"
                  />
                  <span className="text-sm text-slate-700">{col.label}</span>
                </label>
              );
            }
            const tone =
              col.key === "fas_score"
                ? fasTone(value as string | null)
                : col.key === "status"
                  ? statusTone(value as string | null)
                  : "";
            return (
              <label key={col.key} className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {col.label}
                </span>
                <input
                  key={String(value ?? "")}
                  type="text"
                  defaultValue={(value as string | null) ?? ""}
                  list={col.options ? `w-opt-${col.key}` : undefined}
                  onFocus={() => {
                    editingRef.current = true;
                  }}
                  onBlur={(e) => {
                    editingRef.current = false;
                    if (e.target.value !== ((value as string | null) ?? "")) {
                      commitCell(col.key, e.target.value);
                    }
                  }}
                  className={`w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${tone}`}
                />
                {col.options ? (
                  <datalist id={`w-opt-${col.key}`}>
                    {col.options.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="truncate text-[13px] text-slate-800">{value || "—"}</p>
    </div>
  );
}
