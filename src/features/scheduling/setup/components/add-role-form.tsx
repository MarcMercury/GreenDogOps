"use client";

import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastInvalidForm, toastResult } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import { saveRole } from "@/features/scheduling/setup/actions/role-actions";
import { roleFormDefaults } from "@/features/scheduling/setup/lib/role-form-defaults";
import { roleSchema, type RoleFormValues } from "@/features/scheduling/setup/schema/role.schema";

/** Inline "department + new role / title + order" form under the matrix header. */
export function AddRoleForm({
  data,
  onSaved,
}: {
  data: SetupData;
  onSaved: (departmentId: string) => void;
}) {
  const form = useAppForm({
    defaultValues: roleFormDefaults(),
    validators: { onSubmit: formValidator<RoleFormValues>(roleSchema) },
    onSubmit: async ({ value }) => {
      const res = toastResult(await saveRole(value), "Role added");
      if (res.ok) {
        form.reset();
        onSaved(value.department_id);
      }
    },
    onSubmitInvalid: toastInvalidForm,
  });

  const departmentOptions = data.departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
    >
      <form.AppField name="department_id">
        {(field) => (
          <field.NativeSelectField
            label="Department"
            placeholder="Select…"
            options={departmentOptions}
            className="w-auto min-w-44"
          />
        )}
      </form.AppField>
      <form.AppField name="name">
        {(field) => (
          <field.TextField label="New role / title" placeholder="Surgery Tech" className="w-auto" />
        )}
      </form.AppField>
      <form.AppField name="sort_order">
        {(field) => <field.TextField label="Order" type="number" className="w-20" />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>Add role</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
