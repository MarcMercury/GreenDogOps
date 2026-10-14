"use client";

import { SUB_TABS } from "@/features/scheduling/setup/lib/sub-tabs";
import type { SubTab } from "@/features/scheduling/setup/types/sub-tab";

/** The button strip that switches between the Set Up sub-tabs. */
export function SetupSubTabBar({
  active,
  onSelect,
}: {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SUB_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            active === t.key
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
