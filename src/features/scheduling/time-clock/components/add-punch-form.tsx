"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addMissingPunch } from "@/features/scheduling/time-clock/actions/punch-actions";
import { addPunchFormDefaults } from "@/features/scheduling/time-clock/lib/add-punch-defaults";
import {
  addPunchSchema,
  type AddPunchFormValues,
} from "@/features/scheduling/time-clock/schema/add-punch.schema";
import { useAppForm } from "@/features/scheduling/shared/hooks/use-app-form";
import { toastInvalidForm, toastResult } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";

const PUNCH_OPTIONS = [
  { value: "clock_in", label: "Clock in" },
  { value: "lunch_start", label: "Start lunch" },
  { value: "lunch_end", label: "End lunch" },
  { value: "clock_out", label: "Clock out" },
];

const validator = formValidator<AddPunchFormValues>(addPunchSchema);

/** Collapsed button that opens the "add the missing punch" form for one day. */
export function AddPunchForm({
  personId,
  workDate,
  defaultType,
}: {
  personId: string;
  workDate: string;
  defaultType: "clock_in" | "clock_out";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    // The employee and day are fixed by the queue row; they travel with the
    // values so the action can check them like any other input.
    defaultValues: addPunchFormDefaults(personId, workDate, defaultType),
    validators: { onSubmit: validator },
    onSubmit: async ({ value }) => {
      const res = toastResult(await addMissingPunch(value), (r) => r.message);
      if (res.ok) router.refresh();
    },
    onSubmitInvalid: toastInvalidForm,
  });

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add the missing punch
      </Button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <form.AppField name="punch_type">
          {(field) => <field.NativeSelectField label="Punch" options={PUNCH_OPTIONS} />}
        </form.AppField>
        <form.AppField name="time">
          {(field) => <field.TextField label="Time" type="time" />}
        </form.AppField>
      </div>
      <form.AppField name="next_day">
        {(field) => <field.CheckboxField label="after midnight" />}
      </form.AppField>
      <form.AppField name="reason">
        {(field) => (
          <field.TextField
            label="Reason"
            maxLength={1000}
            placeholder="Reason (e.g. confirmed with the employee)"
          />
        )}
      </form.AppField>
      <div className="flex gap-2">
        <form.AppForm>
          <form.SubmitButton size="sm">Add punch</form.SubmitButton>
        </form.AppForm>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
