"use client";

import type { SchedDepartment } from "@/lib/schedule/types";
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
import { saveDepartment } from "@/features/scheduling/setup/actions/department-actions";
import { departmentFormDefaults } from "@/features/scheduling/setup/lib/department-form-defaults";
import {
  departmentSchema,
  type DepartmentFormValues,
} from "@/features/scheduling/setup/schema/department.schema";
import { DeleteDeptButton } from "@/features/scheduling/scheduling-grid/components/delete-dept-button";

/**
 * Add or edit a department directly from the grid. The full form (code,
 * planning flag) lives in Set Up ▸ Departments; here only the name, colour
 * and order are editable and the department stays active.
 */
export function DeptModal({
  dept,
  onClose,
  onDone,
}: {
  dept: SchedDepartment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useAppForm({
    defaultValues: { ...departmentFormDefaults(dept), is_active: true } as DepartmentFormValues,
    validators: { onSubmit: formValidator<DepartmentFormValues>(departmentSchema) },
    onSubmit: async ({ value }) => {
      const res = toastResult(await saveDepartment(value), dept ? "Department saved" : "Department added");
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
            <DialogTitle>{dept ? "Edit department" : "Add department"}</DialogTitle>
            <DialogDescription>
              Departments group the grid&apos;s shift lines and colour their sections.
            </DialogDescription>
          </DialogHeader>
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" placeholder="e.g. Surgery" autoFocus />}
          </form.AppField>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <form.AppField name="color">
              {(field) => <field.TextField label="Color" type="color" className="[&_input]:h-9 [&_input]:cursor-pointer" />}
            </form.AppField>
            <form.AppField name="sort_order">
              {(field) => <field.TextField label="Order" type="number" />}
            </form.AppField>
          </div>
          <DialogFooter className={dept ? "sm:justify-between" : undefined}>
            {dept ? <DeleteDeptButton dept={dept} onDone={onDone} /> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <form.AppForm>
                <form.SubmitButton>{dept ? "Save" : "Add"}</form.SubmitButton>
              </form.AppForm>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
