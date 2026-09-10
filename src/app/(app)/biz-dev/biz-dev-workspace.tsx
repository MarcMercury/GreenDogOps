"use client";

import { useState } from "react";
import { BusinessDevelopment } from "./business-development";
import { PlanningGuideView } from "./planning-guide-view";
import { useBizDevData } from "./use-bizdev-data";

type TabKey = "planner" | "guide";

const TABS: { key: TabKey; label: string }[] = [
  { key: "planner", label: "Business Development" },
  { key: "guide", label: "Planning Guide" },
];

export function BizDevWorkspace({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<TabKey>("planner");
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const {
    locations,
    error,
    patchType,
    toggleDay,
    saveHours,
    addType,
    removeType,
  } = useBizDevData();

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "planner" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-slate-500">
              Lay the planned appointments out across the day, per clinic, in the
              planning-guide format.
            </p>
            <button
              type="button"
              disabled={!locations}
              onClick={() => {
                setGeneratedAt(Date.now());
                setTab("guide");
              }}
              className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
            >
              Convert to planning guide →
            </button>
          </div>
          <BusinessDevelopment
            canEdit={canEdit}
            locations={locations}
            error={error}
            onPatchType={patchType}
            onToggleDay={toggleDay}
            onSaveHours={saveHours}
            onAddType={addType}
            onRemoveType={removeType}
          />
        </div>
      ) : locations ? (
        <PlanningGuideView locations={locations} generatedAt={generatedAt} />
      ) : (
        <p className="text-sm text-slate-400">Loading planner…</p>
      )}
    </div>
  );
}
