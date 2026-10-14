"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SchedRole, SchedShiftTemplate } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { ShiftTemplateList } from "@/features/scheduling/setup/components/shift-template-list";
import { ShiftTemplateForm } from "@/features/scheduling/setup/components/shift-template-form";

// ===========================================================================
// Dept/Shift Template (blank shift lines the Week Template is built from)
// ===========================================================================

export function ShiftsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SchedShiftTemplate | null>(null);

  // Same department set the Week Template grid shows, in the same order.
  const departments = useMemo(
    () =>
      data.departments
        .filter((d) => d.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [data.departments],
  );

  const rolesByDept = useMemo(() => {
    const m = new Map<string, SchedRole[]>();
    for (const r of data.roles) {
      if (!m.has(r.department_id)) m.set(r.department_id, []);
      m.get(r.department_id)!.push(r);
    }
    return m;
  }, [data.roles]);

  const roleName = (id: string | null) =>
    id ? data.roles.find((r) => r.id === id)?.name ?? "—" : "—";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <ShiftTemplateList
        departments={departments}
        templates={data.templates}
        roleName={roleName}
        onEdit={setEditing}
        onDeleted={(id) => {
          if (editing?.id === id) setEditing(null);
        }}
      />
      {/* Re-keyed on the line so edits start from its values, not the last draft. */}
      <ShiftTemplateForm
        key={editing?.id ?? "new"}
        editing={editing}
        departments={departments}
        rolesByDept={rolesByDept}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
        onCancel={() => setEditing(null)}
      />
    </div>
  );
}
