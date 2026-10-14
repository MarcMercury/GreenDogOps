"use client";

import type { SchedDepartment, SchedRole, SchedShiftTemplate } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastInvalidForm, toastResult } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import { saveShiftTemplate } from "@/features/scheduling/setup/actions/shift-template-actions";
import { shiftTemplateFormDefaults } from "@/features/scheduling/setup/lib/shift-template-form-defaults";
import {
  NEW_ROLE_OPTION,
  toShiftTemplateInput,
} from "@/features/scheduling/setup/lib/shift-template-submit";
import {
  shiftTemplateFormSchema,
  type ShiftTemplateFormValues,
} from "@/features/scheduling/setup/schema/shift-template.schema";

/**
 * New / edit template-line form. The parent re-keys it on the line being
 * edited. The Role select offers the department's roles plus "+ New role…",
 * which reveals the name box; `toShiftTemplateInput` maps that choice for the
 * action.
 */
export function ShiftTemplateForm({
  editing,
  departments,
  rolesByDept,
  onSaved,
  onCancel,
}: {
  editing: SchedShiftTemplate | null;
  departments: SchedDepartment[];
  rolesByDept: Map<string, SchedRole[]>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: shiftTemplateFormDefaults(editing),
    validators: { onSubmit: formValidator<ShiftTemplateFormValues>(shiftTemplateFormSchema) },
    onSubmit: async ({ value }) => {
      const res = toastResult(
        await saveShiftTemplate(toShiftTemplateInput(value)),
        editing ? "Template line saved" : "Template line added",
      );
      if (res.ok) {
        form.reset();
        onSaved();
      }
    },
    onSubmitInvalid: toastInvalidForm,
  });

  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? "Edit template line" : "New template line"}</CardTitle>
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
          <form.AppField name="department_id">
            {(field) => (
              <field.NativeSelectField
                label="Department"
                placeholder="Select…"
                options={departmentOptions}
                // A new department means a new set of roles: back to "— any —".
                onValueChange={() => form.setFieldValue("role_id", "")}
              />
            )}
          </form.AppField>
          <form.Subscribe
            selector={(s) => ({ departmentId: s.values.department_id, roleId: s.values.role_id })}
          >
            {({ departmentId, roleId }) => (
              <>
                <form.AppField name="role_id">
                  {(field) => (
                    <field.NativeSelectField
                      label="Role (eligibility)"
                      placeholder="— any —"
                      disabled={!departmentId}
                      options={[
                        ...(rolesByDept.get(departmentId) ?? []).map((r) => ({
                          value: r.id,
                          label: r.name,
                        })),
                        { value: NEW_ROLE_OPTION, label: "+ New role…" },
                      ]}
                    />
                  )}
                </form.AppField>
                {roleId === NEW_ROLE_OPTION && (
                  <form.AppField name="new_role_name">
                    {(field) => (
                      <field.TextField
                        label="New role name"
                        placeholder="e.g. Clinic Tech"
                        description="Adds one eligibility checkbox for this role — reuse it for every shift time. Set who's eligible in Roles & Eligibility."
                      />
                    )}
                  </form.AppField>
                )}
              </>
            )}
          </form.Subscribe>
          <form.AppField name="label">
            {(field) => <field.TextField label="Label (optional)" placeholder="Defaults to role name" />}
          </form.AppField>
          <div className="flex gap-3">
            <form.AppField name="start_time">
              {(field) => <field.TextField label="Start" type="time" />}
            </form.AppField>
            <form.AppField name="end_time">
              {(field) => <field.TextField label="End" type="time" />}
            </form.AppField>
            <form.AppField name="sort_order">
              {(field) => <field.TextField label="Order" type="number" className="w-20 shrink-0" />}
            </form.AppField>
          </div>
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
