"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SchedRole, SchedShiftTemplate } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  deleteShiftTemplate,
  saveShiftTemplate,
} from "@/features/scheduling/setup/actions/shift-template-actions";
import { ShiftTemplateList } from "@/features/scheduling/setup/components/shift-template-list";
import { ShiftTemplateForm } from "@/features/scheduling/setup/components/shift-template-form";

// ===========================================================================
// Dept/Shift Template (blank shift lines the Week Template is built from)
// ===========================================================================

export function ShiftsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SchedShiftTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const [formDept, setFormDept] = useState<string>(editing?.department_id ?? "");
  // "" = any · "__new__" = create role inline · otherwise an existing role id.
  const [roleSel, setRoleSel] = useState<string>(editing?.role_id ?? "");
  const formRoles = rolesByDept.get(formDept) ?? [];

  function submit(fd: FormData) {
    setError(null);
    if (roleSel === "__new__") {
      fd.set("role_id", "");
    } else {
      fd.set("role_id", roleSel);
      fd.delete("new_role_name");
    }
    start(async () => {
      const res = await saveShiftTemplate(fd);
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        setFormDept("");
        setRoleSel("");
        router.refresh();
      }
    });
  }

  function edit(t: SchedShiftTemplate) {
    setEditing(t);
    setFormDept(t.department_id);
    setRoleSel(t.role_id ?? "");
  }

  function cancel() {
    setEditing(null);
    setFormDept("");
    setRoleSel("");
  }

  function remove(id: string) {
    start(async () => {
      await deleteShiftTemplate(id);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <ShiftTemplateList
        departments={departments}
        templates={data.templates}
        roleName={roleName}
        onEdit={edit}
        onDelete={remove}
      />
      <ShiftTemplateForm
        editing={editing}
        departments={departments}
        formDept={formDept}
        roleSel={roleSel}
        formRoles={formRoles}
        pending={pending}
        error={error}
        onDeptChange={(value) => {
          setFormDept(value);
          setRoleSel("");
        }}
        onRoleChange={setRoleSel}
        onSubmit={submit}
        onCancel={cancel}
      />
    </div>
  );
}
