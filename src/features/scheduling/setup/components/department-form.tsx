"use client";

import type { SchedDepartment } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastInvalidForm, toastResult } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import { saveDepartment } from "@/features/scheduling/setup/actions/department-actions";
import { departmentFormDefaults } from "@/features/scheduling/setup/lib/department-form-defaults";
import {
  departmentSchema,
  type DepartmentFormValues,
} from "@/features/scheduling/setup/schema/department.schema";

/**
 * New / edit department form. The parent re-keys it on the department being
 * edited so the fields start from that department's values.
 */
export function DepartmentForm({
  editing,
  onSaved,
  onCancel,
}: {
  editing: SchedDepartment | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: departmentFormDefaults(editing),
    validators: { onSubmit: formValidator<DepartmentFormValues>(departmentSchema) },
    onSubmit: async ({ value }) => {
      const res = toastResult(
        await saveDepartment(value),
        editing ? "Department saved" : "Department added",
      );
      if (res.ok) {
        form.reset();
        onSaved();
      }
    },
    onSubmitInvalid: toastInvalidForm,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? "Edit department" : "New department"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-3"
        >
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" placeholder="VET-SURGERY" />}
          </form.AppField>
          <div className="flex gap-3">
            <form.AppField name="code">
              {(field) => <field.TextField label="Code" placeholder="SURG" />}
            </form.AppField>
            <form.AppField name="sort_order">
              {(field) => <field.TextField label="Order" type="number" className="w-24 shrink-0" />}
            </form.AppField>
          </div>
          <form.AppField name="color">
            {(field) => <field.TextField label="Color" type="color" className="w-24" />}
          </form.AppField>
          <form.AppField name="is_active">
            {(field) => <field.CheckboxField label="Active" />}
          </form.AppField>
          <form.AppField name="show_in_planning">
            {(field) => (
              <field.CheckboxField
                label="Planning Guide"
                description="Show this department in the Planning Guides dropdown and as a Daily Capacity area."
              />
            )}
          </form.AppField>
          <div className="flex gap-2">
            <form.AppForm>
              <form.SubmitButton>{editing ? "Save" : "Add"}</form.SubmitButton>
            </form.AppForm>
            {editing && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
