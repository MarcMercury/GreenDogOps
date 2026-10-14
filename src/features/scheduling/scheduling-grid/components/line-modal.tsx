"use client";

import type { SchedDepartment, SchedRole, SchedWeekLine } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastInvalidForm, toastResult } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import {
  addWeekLine,
  updateWeekLine,
} from "@/features/scheduling/scheduling-grid/actions/week-line-actions";
import {
  toWeekLineInput,
  weekLineFormDefaults,
} from "@/features/scheduling/scheduling-grid/lib/week-line-form";
import {
  NEW_ROLE_OPTION,
  weekLineFormSchema,
  type WeekLineFormValues,
} from "@/features/scheduling/scheduling-grid/schema/week-line.schema";

/** Add or edit a shift line on the week's grid. */
export function LineModal({
  weekId,
  departments,
  roles,
  line,
  defaultDeptId,
  onClose,
  onDone,
}: {
  weekId: string;
  departments: SchedDepartment[];
  roles: SchedRole[];
  line: SchedWeekLine | null;
  defaultDeptId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useAppForm({
    defaultValues: weekLineFormDefaults(line, defaultDeptId),
    validators: { onSubmit: formValidator<WeekLineFormValues>(weekLineFormSchema) },
    onSubmit: async ({ value }) => {
      const input = toWeekLineInput(value);
      const res = toastResult(
        line ? await updateWeekLine({ ...input, id: line.id }) : await addWeekLine({ ...input, week_id: weekId }),
        line ? "Shift line saved" : "Shift line added",
      );
      if (res.ok) onDone();
    },
    onSubmitInvalid: toastInvalidForm,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{line ? "Edit shift line" : "Add shift line"}</DialogTitle>
            <DialogDescription>
              A shift line is one row of the grid: a department, the role that may fill it, and its hours.
            </DialogDescription>
          </DialogHeader>

          <form.AppField name="department_id">
            {(field) => (
              <field.NativeSelectField
                label="Department"
                placeholder="Select…"
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
                // A new department has different roles, so the role choice starts over.
                onValueChange={() => form.setFieldValue("role_id", "")}
              />
            )}
          </form.AppField>

          <form.Subscribe selector={(s) => s.values.department_id}>
            {(departmentId) => (
              <form.AppField name="role_id">
                {(field) => (
                  <field.NativeSelectField
                    label="Role (eligibility)"
                    placeholder="— any —"
                    disabled={!departmentId}
                    options={[
                      ...roles
                        .filter((r) => r.department_id === departmentId)
                        .map((r) => ({ value: r.id, label: r.name })),
                      { value: NEW_ROLE_OPTION, label: "+ New role…" },
                    ]}
                  />
                )}
              </form.AppField>
            )}
          </form.Subscribe>

          <form.Subscribe selector={(s) => s.values.role_id === NEW_ROLE_OPTION}>
            {(isNewRole) =>
              isNewRole ? (
                <form.AppField name="new_role_name">
                  {(field) => (
                    <field.TextField
                      label="New role name"
                      placeholder="e.g. Surgery Tech"
                      description="Set who is eligible for it in Set Up → Roles & Eligibility."
                      autoFocus
                    />
                  )}
                </form.AppField>
              ) : null
            }
          </form.Subscribe>

          <form.AppField name="label">
            {(field) => <field.TextField label="Label (optional)" placeholder="e.g. Float / Coverage" />}
          </form.AppField>

          <div className="grid grid-cols-[1fr_1fr_5rem] gap-3">
            <form.AppField name="start_time">
              {(field) => <field.TextField label="Start" type="time" />}
            </form.AppField>
            <form.AppField name="end_time">
              {(field) => <field.TextField label="End" type="time" />}
            </form.AppField>
            <form.AppField name="sort_order">
              {(field) => <field.TextField label="Order" type="number" />}
            </form.AppField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>{line ? "Save" : "Add line"}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
