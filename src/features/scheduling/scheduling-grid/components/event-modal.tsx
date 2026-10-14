"use client";

import { dateForDay, type ScheduleLocation } from "@/lib/schedule/types";
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
import { toastInvalidForm } from "@/features/scheduling/shared/lib/action-toast";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import {
  eventTitleSchema,
  type EventTitleValues,
} from "@/features/scheduling/scheduling-grid/schema/event.schema";

/** Add or edit a per-location/day event banner. */
export function EventModal({
  location,
  day,
  weekStart,
  initial,
  onClose,
  onSave,
}: {
  location: ScheduleLocation;
  day: number;
  weekStart: string;
  initial: string;
  onClose: () => void;
  /** A blank title clears the event. */
  onSave: (title: string) => void | Promise<unknown>;
}) {
  const dateLabel = new Date(`${dateForDay(weekStart, day)}T00:00:00`).toLocaleDateString(
    undefined,
    { weekday: "long", month: "short", day: "numeric" },
  );
  const form = useAppForm({
    defaultValues: { title: initial } as EventTitleValues,
    validators: { onSubmit: formValidator<EventTitleValues>(eventTitleSchema) },
    onSubmit: async ({ value }) => {
      await onSave(value.title);
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
            <DialogTitle className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: location.color ?? "#64748b" }}
              />
              Event · {location.name}
            </DialogTitle>
            <DialogDescription>{dateLabel}</DialogDescription>
          </DialogHeader>
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                label="Event"
                placeholder="e.g. Full Team Meeting, Adoption Event…"
                autoFocus
                maxLength={200}
              />
            )}
          </form.AppField>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => void onSave("")}>
              Clear
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <form.AppForm>
                <form.SubmitButton>Save</form.SubmitButton>
              </form.AppForm>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
