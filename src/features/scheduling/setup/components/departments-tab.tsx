"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SchedDepartment } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  deleteDepartment,
  saveDepartment,
} from "@/features/scheduling/setup/actions/department-actions";
import { DepartmentList } from "@/features/scheduling/setup/components/department-list";
import { DepartmentForm } from "@/features/scheduling/setup/components/department-form";

// ===========================================================================
// Departments
// ===========================================================================

export function DepartmentsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SchedDepartment | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveDepartment(fd);
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteDepartment(id);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <DepartmentList
        departments={data.departments}
        onEdit={setEditing}
        onDelete={remove}
      />
      <DepartmentForm
        editing={editing}
        pending={pending}
        error={error}
        onSubmit={submit}
        onCancel={() => setEditing(null)}
      />
    </div>
  );
}
