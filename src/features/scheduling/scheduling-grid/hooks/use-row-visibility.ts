"use client";

import { useCallback, useState } from "react";
import {
  NOTHING_HIDDEN,
  toggled,
  type RowVisibility,
} from "@/features/scheduling/scheduling-grid/lib/row-visibility";

/** The Rows card's state: which departments and shift lines are hidden from the grid. */
export function useRowVisibility() {
  const [hidden, setHidden] = useState<RowVisibility>(NOTHING_HIDDEN);

  const toggleDepartment = useCallback(
    (id: string) => setHidden((h) => ({ ...h, departments: toggled(h.departments, id) })),
    [],
  );
  const toggleLine = useCallback(
    (id: string) => setHidden((h) => ({ ...h, lines: toggled(h.lines, id) })),
    [],
  );
  const showAll = useCallback(() => setHidden(NOTHING_HIDDEN), []);
  const hideAll = useCallback(
    (departmentIds: string[]) => setHidden({ departments: new Set(departmentIds), lines: new Set() }),
    [],
  );

  return { hidden, toggleDepartment, toggleLine, showAll, hideAll };
}
