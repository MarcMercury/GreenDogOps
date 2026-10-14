"use client";

import { useEffect } from "react";
import type { StandardSchemaV1 } from "@tanstack/react-form";
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
import {
  toastInvalidForm,
  toastResult,
  type SuccessMessage,
  type ToastableResult,
} from "@/features/scheduling/shared/lib/action-toast";

export interface PromptValues {
  value: string;
}

/**
 * The `window.prompt` replacement: a dialog with one text field, validated by
 * the caller's schema (via `formValidator<PromptValues>(…)`), that runs an
 * action with the entered text and toasts the outcome. Closes on success.
 */
export function PromptDialog<R extends ToastableResult>({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  submitLabel = "Save",
  validator,
  onSubmit,
  success,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  validator?: StandardSchemaV1<PromptValues, unknown>;
  onSubmit: (value: string) => Promise<R>;
  success: SuccessMessage<R>;
}) {
  const form = useAppForm({
    defaultValues: { value: defaultValue } as PromptValues,
    validators: validator ? { onSubmit: validator } : undefined,
    onSubmit: async ({ value }) => {
      const result = toastResult(await onSubmit(value.value), success);
      if (result.ok) onOpenChange(false);
    },
    onSubmitInvalid: toastInvalidForm,
  });

  // Each opening starts from the caller's current default (a rename shows the
  // current name, a copy a suggested one), never from the last attempt.
  useEffect(() => {
    if (open) form.reset({ value: defaultValue });
  }, [open, defaultValue, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <form.AppField name="value">
            {(field) => <field.TextField label={label} placeholder={placeholder} autoFocus />}
          </form.AppField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>{submitLabel}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
