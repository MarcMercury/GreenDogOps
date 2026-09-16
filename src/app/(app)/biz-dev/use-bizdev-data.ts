"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type {
  BizDevHours,
  BizDevLocation,
  BizDevOpenDays,
} from "@/lib/reporting/types";
import {
  getBusinessDevelopmentData,
  updateBizDevApptType,
  saveBizDevOpenDays,
  saveBizDevHours,
  addBizDevApptType,
  deleteBizDevApptType,
  refreshBizDevMetrics,
  resetBizDevMetricOverrides,
} from "../reporting/actions";

export interface BizDevPatch {
  avg_value?: number;
  avg_per_day?: number;
  planned_per_day?: number;
  planned_per_week?: number;
  cadence?: "daily" | "weekly";
  max_per_day?: number;
  included?: boolean;
  hidden?: boolean;
}

export interface BizDevData {
  /** null while loading. */
  locations: BizDevLocation[] | null;
  error: string | null;
  patchType: (locId: string, typeId: string, patch: BizDevPatch) => void;
  toggleDay: (locId: string, key: keyof BizDevOpenDays) => void;
  saveHours: (locId: string, hours: BizDevHours) => void;
  addType: (locId: string, name: string, value: number) => void;
  removeType: (locId: string, typeId: string) => void;
  /** Re-derive avg/day + avg value from the latest ezyVet data. */
  refreshMetrics: () => void;
  /** Drop a clinic's hand-edited base numbers and re-derive them. */
  resetOverrides: (locId: string) => void;
  /** True while a refresh is in flight. */
  refreshing: boolean;
}

/**
 * Loads the Business Development planner and applies edits optimistically,
 * persisting each change in the background. Shared by the planner tab and the
 * planning-guide conversion so both read the same live numbers.
 */
export function useBizDevData(): BizDevData {
  const [locations, setLocations] = useState<BizDevLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getBusinessDevelopmentData()
      .then((d) => {
        if (active) setLocations(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load.");
      });
    return () => {
      active = false;
    };
  }, []);

  const patchType = useCallback(
    (locId: string, typeId: string, patch: BizDevPatch) => {
      setLocations((prev) =>
        prev
          ? prev.map((l) =>
              l.location_id === locId
                ? {
                    ...l,
                    types: l.types.map((t) =>
                      t.id === typeId ? { ...t, ...patch } : t,
                    ),
                  }
                : l,
            )
          : prev,
      );
      startTransition(async () => {
        const res = await updateBizDevApptType(typeId, patch);
        if (!res.ok) setError(res.error);
      });
    },
    [],
  );

  const toggleDay = useCallback((locId: string, key: keyof BizDevOpenDays) => {
    let next: BizDevOpenDays | null = null;
    setLocations((prev) =>
      prev
        ? prev.map((l) => {
            if (l.location_id !== locId) return l;
            const open_days = { ...l.open_days, [key]: !l.open_days[key] };
            next = open_days;
            return { ...l, open_days };
          })
        : prev,
    );
    if (next) {
      const days = next;
      startTransition(async () => {
        const res = await saveBizDevOpenDays(locId, days);
        if (!res.ok) setError(res.error);
      });
    }
  }, []);

  const saveHours = useCallback((locId: string, hours: BizDevHours) => {
    setLocations((prev) =>
      prev
        ? prev.map((l) => (l.location_id === locId ? { ...l, hours } : l))
        : prev,
    );
    startTransition(async () => {
      const res = await saveBizDevHours(locId, hours);
      if (!res.ok) setError(res.error);
    });
  }, []);

  const addType = useCallback((locId: string, name: string, value: number) => {
    startTransition(async () => {
      const res = await addBizDevApptType(locId, name, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLocations((prev) =>
        prev
          ? prev.map((l) =>
              l.location_id === locId
                ? { ...l, types: [...l.types, res.row] }
                : l,
            )
          : prev,
      );
    });
  }, []);

  const removeType = useCallback((locId: string, typeId: string) => {
    setLocations((prev) =>
      prev
        ? prev.map((l) =>
            l.location_id === locId
              ? { ...l, types: l.types.filter((t) => t.id !== typeId) }
              : l,
          )
        : prev,
    );
    startTransition(async () => {
      const res = await deleteBizDevApptType(typeId);
      if (!res.ok) setError(res.error);
    });
  }, []);

  const reload = useCallback(
    async (run: () => Promise<{ ok: boolean; error?: string }>) => {
      setRefreshing(true);
      try {
        const res = await run();
        if (!res.ok) {
          setError(res.error ?? "Refresh failed.");
          return;
        }
        setError(null);
        setLocations(await getBusinessDevelopmentData());
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Refresh failed.");
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  const refreshMetrics = useCallback(() => {
    void reload(() => refreshBizDevMetrics());
  }, [reload]);

  const resetOverrides = useCallback(
    (locId: string) => {
      void reload(() => resetBizDevMetricOverrides(locId));
    },
    [reload],
  );

  return {
    locations,
    error,
    patchType,
    toggleDay,
    saveHours,
    addType,
    removeType,
    refreshMetrics,
    resetOverrides,
    refreshing,
  };
}
