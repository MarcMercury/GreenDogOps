"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getGlossaryEntries,
  removeGlossaryEntry,
  saveGlossaryEntry,
  suggestGlossaryEntries,
  type GlossaryEntry,
} from "./glossary-actions";

const EMPTY = { term: "", aliases: "", definition: "", sql_hint: "" };

/**
 * The shared business vocabulary. Anyone who can edit Reporting can add or
 * correct a term; "Suggest from recent questions" drafts entries out of the
 * question log so the glossary fills itself in rather than needing a sit-down.
 */
export function GlossaryPanel({ canEdit }: { canEdit: boolean }) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getGlossaryEntries()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const startEdit = (e: GlossaryEntry) => {
    setEditing(e.id);
    setForm({
      term: e.term,
      aliases: e.aliases.join(", "),
      definition: e.definition,
      sql_hint: e.sql_hint ?? "",
    });
    setNote(null);
  };

  const save = async (status: "draft" | "active") => {
    setBusy(true);
    setNote(null);
    const res = await saveGlossaryEntry({
      id: editing && editing !== "new" ? editing : undefined,
      term: form.term,
      aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      definition: form.definition,
      sql_hint: form.sql_hint,
      status,
    });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error ?? "Could not save.");
      return;
    }
    setEditing(null);
    setForm(EMPTY);
    refresh();
  };

  const suggest = async () => {
    setBusy(true);
    setNote("Reading recent questions…");
    const res = await suggestGlossaryEntries();
    setBusy(false);
    setNote(
      !res.ok
        ? (res.error ?? "Could not draft suggestions.")
        : res.added
          ? `Drafted ${res.added} ${res.added === 1 ? "entry" : "entries"} — review them below.`
          : "Nothing new worth adding from recent questions.",
    );
    refresh();
  };

  const drafts = entries.filter((e) => e.status === "draft");

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-medium uppercase tracking-wide text-slate-400 transition hover:text-slate-600"
        >
          {open ? "Hide" : "Show"} glossary
          {entries.length ? ` (${entries.length})` : ""}
          {drafts.length ? (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {drafts.length} to review
            </span>
          ) : null}
        </button>
        {open && canEdit ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={suggest}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Suggest from recent questions
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing("new");
                setForm(EMPTY);
                setNote(null);
              }}
              className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              Add term
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-slate-100">
          {note ? (
            <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">
              {note}
            </p>
          ) : null}

          {editing ? (
            <div className="space-y-2 border-b border-slate-100 bg-slate-50/40 p-4">
              <input
                value={form.term}
                onChange={(e) => setForm({ ...form, term: e.target.value })}
                placeholder="Term — e.g. expiring wellness plan"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
              />
              <input
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="Other ways people say it, comma separated — renewing plan, lapsing plan"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
              />
              <textarea
                value={form.definition}
                onChange={(e) => setForm({ ...form, definition: e.target.value })}
                rows={2}
                placeholder="What it means here — the rule a manager would agree with"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
              />
              <textarea
                value={form.sql_hint}
                onChange={(e) => setForm({ ...form, sql_hint: e.target.value })}
                rows={2}
                placeholder="Optional: the table, filter or expression that expresses it"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !form.term.trim() || !form.definition.trim()}
                  onClick={() => void save("active")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  Save &amp; use
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setNote(null);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {!entries.length ? (
            <p className="px-4 py-3 text-xs text-slate-400">
              No terms yet. Add one, or let the system draft some from recent questions.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {entries.map((e) => (
                <li key={e.id} className={e.status === "draft" ? "bg-amber-50/40" : ""}>
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-700">
                        {e.term}
                        {e.status === "draft" ? (
                          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                            draft
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{e.definition}</p>
                      {e.aliases.length ? (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          also: {e.aliases.join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {e.status === "draft" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setBusy(true);
                              void saveGlossaryEntry({
                                id: e.id,
                                term: e.term,
                                aliases: e.aliases,
                                definition: e.definition,
                                sql_hint: e.sql_hint,
                                status: "active",
                              }).then(() => {
                                setBusy(false);
                                refresh();
                              });
                            }}
                            className="rounded px-1.5 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                          >
                            Accept
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void removeGlossaryEntry(e.id).then(() => {
                              setBusy(false);
                              refresh();
                            });
                          }}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:text-rose-600"
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
