"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  hydrateCard,
  type CardDoc,
  type CardListItem,
  type CardMedRow,
  type CardTemplate,
} from "@/lib/med-ops/templates";
import { cardStatusStyle, type MedicalBoardRow } from "@/lib/med-ops/types";

type Patch = Record<string, unknown>;

/**
 * One patient card — the digital replacement for a "P #n" tab in the AP and
 * Surgery workbooks. Every edit is merged into the row's `card` document.
 */
export function PatientCard({
  row,
  tpl,
  onPatch,
  onDelete,
}: {
  row: MedicalBoardRow;
  tpl: CardTemplate;
  onPatch: (rowId: string, patch: Patch) => void;
  onDelete: (rowId: string) => void;
}) {
  const card = useMemo(
    () => hydrateCard(row.card as CardDoc | null, tpl),
    [row.card, tpl],
  );
  const [open, setOpen] = useState(true);

  const patch = useCallback(
    (p: Patch) => onPatch(row.id, p),
    [onPatch, row.id],
  );

  const setMed = (index: number, next: Partial<CardMedRow>) => {
    const meds = (card.meds ?? []).map((m, i) =>
      i === index ? { ...m, ...next } : m,
    );
    patch({ meds });
  };

  const setListItem = (index: number, next: Partial<CardListItem>) => {
    const list = (card.list ?? []).map((l, i) =>
      i === index ? { ...l, ...next } : l,
    );
    patch({ list });
  };

  const title =
    card.signalment?.trim() ||
    [row.patient, row.client_name].filter(Boolean).join(" · ") ||
    "New patient";

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-slate-400 transition hover:text-slate-600"
          aria-label={open ? "Collapse card" : "Expand card"}
        >
          <span className={`inline-block transition-transform ${open ? "" : "-rotate-90"}`}>
            ⌄
          </span>
        </button>
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {row.appt_time ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
            {row.appt_time}
          </span>
        ) : null}
        <select
          value={card.status ?? ""}
          onChange={(e) => patch({ status: e.target.value })}
          className={`ml-auto rounded-lg border-0 px-2 py-1 text-xs font-semibold shadow-sm outline-none ${cardStatusStyle(card.status ?? null).chip}`}
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
        <button
          type="button"
          onClick={() => onDelete(row.id)}
          title="Remove from board"
          className="rounded px-1.5 py-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
        >
          ×
        </button>
      </header>

      {open ? (
        <div className="space-y-3 p-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <Text
                label="Signalment"
                value={card.signalment ?? ""}
                placeholder='"Name" Last, K9, 6Y, FS, breed'
                onCommit={(v) => patch({ signalment: v })}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Text
                  label="WT (kg)"
                  value={card.weight_kg ?? ""}
                  onCommit={(v) => patch({ weight_kg: v })}
                />
                <Text
                  label="BW type"
                  value={card.bw_type ?? ""}
                  placeholder="IHBW"
                  onCommit={(v) => patch({ bw_type: v })}
                />
                <Text
                  label="IVC"
                  value={card.ivc ?? ""}
                  placeholder="20R"
                  onCommit={(v) => patch({ ivc: v })}
                />
                <Check
                  label="BW done"
                  checked={Boolean(card.bw_done)}
                  onChange={(v) => patch({ bw_done: v })}
                />
              </div>
              <Text
                label="BW results"
                value={card.bw_results ?? ""}
                placeholder="8/6/26: Creat/BUN+, ALT+"
                onCommit={(v) => patch({ bw_results: v })}
              />
              <Text
                label="Conditions / alerts"
                value={card.alerts ?? ""}
                tone="bg-amber-50"
                onCommit={(v) => patch({ alerts: v })}
              />
            </div>

            <fieldset className="rounded-lg border border-slate-200 p-2">
              <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {tpl.listLabel}
              </legend>
              <div className="space-y-1">
                {(card.list ?? []).map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-3 text-[10px] text-slate-400">{i + 1}</span>
                    {tpl.listHasCheck ? (
                      <input
                        type="checkbox"
                        checked={Boolean(item.done)}
                        onChange={(e) => setListItem(i, { done: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                        aria-label={`${tpl.listLabel} ${i + 1} done`}
                      />
                    ) : null}
                    <BareText
                      value={item.text}
                      onCommit={(v) => setListItem(i, { text: v })}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          </div>

          <MedTable
            tpl={tpl}
            meds={card.meds ?? []}
            onChange={setMed}
          />

          <div className="grid gap-3 lg:grid-cols-3">
            <fieldset className="rounded-lg border border-slate-200 p-2 lg:col-span-2">
              <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Prep checklist
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {tpl.checklist.map((item) => (
                  <div key={item.key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(card.checklist?.[item.key])}
                      onChange={(e) =>
                        patch({
                          checklist: {
                            ...(card.checklist ?? {}),
                            [item.key]: e.target.checked,
                          },
                        })
                      }
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-emerald-600"
                    />
                    <span className="shrink-0 text-[11px] text-slate-600">
                      {item.label}
                    </span>
                    {item.withText ? (
                      <BareText
                        value={card.checklist_text?.[item.key] ?? ""}
                        onCommit={(v) =>
                          patch({
                            checklist_text: {
                              ...(card.checklist_text ?? {}),
                              [item.key]: v,
                            },
                          })
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              {tpl.statusFields.map((f) => (
                <Text
                  key={f.key}
                  label={f.label}
                  placeholder={f.placeholder}
                  value={card.fields?.[f.key] ?? ""}
                  onCommit={(v) =>
                    patch({ fields: { ...(card.fields ?? {}), [f.key]: v } })
                  }
                />
              ))}
            </div>
          </div>

          {tpl.anesthesia.length > 0 ? (
            <fieldset className="rounded-lg border border-slate-200 p-2">
              <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Anesthesia
              </legend>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {tpl.anesthesia.map((f) => (
                  <Text
                    key={f.key}
                    label={f.label}
                    value={card.anesthesia?.[f.key] ?? ""}
                    onCommit={(v) =>
                      patch({
                        anesthesia: { ...(card.anesthesia ?? {}), [f.key]: v },
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            {tpl.notes.map((n) => (
              <label key={n.key} className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {n.label}
                </span>
                <TextArea
                  value={card.notes?.[n.key] ?? ""}
                  onCommit={(v) =>
                    patch({ notes: { ...(card.notes ?? {}), [n.key]: v } })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MedTable({
  tpl,
  meds,
  onChange,
}: {
  tpl: CardTemplate;
  meds: CardMedRow[];
  onChange: (index: number, next: Partial<CardMedRow>) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-[11px]">
        <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-1 py-1 text-left" colSpan={4}>
              {tpl.medGroups[0]}
            </th>
            <th className="border-l border-slate-200 px-1 py-1 text-left" colSpan={4}>
              {tpl.medGroups[1]}
            </th>
          </tr>
          <tr className="text-[9px]">
            <th className="w-10 px-1 py-1">Drawn</th>
            <th className="w-12 px-1 py-1">Int.</th>
            <th className="w-10 px-1 py-1">Ad</th>
            <th className="px-1 py-1 text-left">Drug / dose</th>
            <th className="w-10 border-l border-slate-200 px-1 py-1">Drn</th>
            <th className="w-10 px-1 py-1">Ad</th>
            <th className="px-1 py-1 text-left">Titrated</th>
            <th className="w-14 px-1 py-1 text-left">Route</th>
          </tr>
        </thead>
        <tbody>
          {meds.map((m, i) => {
            const t = tpl.meds[i];
            if (t?.freeform) {
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td colSpan={8} className="px-1 py-1">
                    <BareText
                      value={m.drug}
                      placeholder={t.drug}
                      onCommit={(v) => onChange(i, { drug: v })}
                    />
                  </td>
                </tr>
              );
            }
            return (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={m.drawn}
                    onChange={(e) => onChange(i, { drawn: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    aria-label="Drawn"
                  />
                </td>
                <td className="px-1 py-1">
                  <BareText
                    value={m.initials}
                    onCommit={(v) => onChange(i, { initials: v })}
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={m.given}
                    onChange={(e) => onChange(i, { given: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    aria-label="Administered"
                  />
                </td>
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1">
                    <BareText
                      value={m.drug}
                      placeholder="Drug"
                      onCommit={(v) => onChange(i, { drug: v })}
                    />
                    <BareText
                      value={m.dose}
                      placeholder="dose"
                      className="w-16"
                      onCommit={(v) => onChange(i, { dose: v })}
                    />
                    <span className="text-slate-400">mL</span>
                  </div>
                </td>
                <td className="border-l border-slate-200 px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={m.drawn2}
                    onChange={(e) => onChange(i, { drawn2: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    aria-label="Drawn (second)"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={m.given2}
                    onChange={(e) => onChange(i, { given2: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    aria-label="Administered (second)"
                  />
                </td>
                <td className="px-1 py-1">
                  <BareText
                    value={m.dose2}
                    onCommit={(v) => onChange(i, { dose2: v })}
                  />
                </td>
                <td className="px-1 py-1">
                  <BareText
                    value={m.route2}
                    onCommit={(v) => onChange(i, { route2: v })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs — uncontrolled with commit-on-blur, remounted by key when the stored
// value changes so a teammate's edit replaces what is on screen.
// ---------------------------------------------------------------------------

function BareText({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onCommit: (v: string) => void;
}) {
  const initial = useRef(value);
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      onFocus={() => {
        initial.current = value;
      }}
      onBlur={(e) => {
        if (e.target.value !== initial.current) onCommit(e.target.value);
      }}
      className={`w-full min-w-0 rounded border border-transparent px-1 py-0.5 text-[11px] transition hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400 ${className ?? ""}`}
    />
  );
}

function Text({
  label,
  value,
  placeholder,
  tone,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  tone?: string;
  onCommit: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <div className={`rounded border border-slate-200 ${tone ?? ""}`}>
        <BareText value={value} placeholder={placeholder} onCommit={onCommit} />
      </div>
    </label>
  );
}

function TextArea({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const initial = useRef(value);
  return (
    <textarea
      key={value}
      defaultValue={value}
      rows={2}
      onFocus={() => {
        initial.current = value;
      }}
      onBlur={(e) => {
        if (e.target.value !== initial.current) onCommit(e.target.value);
      }}
      className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
    />
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-end gap-1.5 pb-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
      />
      <span className="text-[11px] text-slate-600">{label}</span>
    </label>
  );
}
