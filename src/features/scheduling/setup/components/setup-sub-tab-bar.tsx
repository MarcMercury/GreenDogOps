"use client";

import { Button } from "@/components/ui/button";
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
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Set Up sections">
      {SUB_TABS.map((t) => (
        <Button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          variant={active === t.key ? "default" : "outline"}
          size="sm"
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
