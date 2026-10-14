"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SchedDepartment } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { DepartmentList } from "@/features/scheduling/setup/components/department-list";
import { DepartmentForm } from "@/features/scheduling/setup/components/department-form";

// ===========================================================================
// Departments
// ===========================================================================

export function DepartmentsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SchedDepartment | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <DepartmentList
        departments={data.departments}
        onEdit={setEditing}
        onDeleted={(id) => {
          if (editing?.id === id) setEditing(null);
        }}
      />
      {/* Re-keyed on the department so edits start from its values, not the last draft. */}
      <DepartmentForm
        key={editing?.id ?? "new"}
        editing={editing}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
        onCancel={() => setEditing(null)}
      />
    </div>
  );
}
