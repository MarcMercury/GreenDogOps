"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFormContext } from "@/features/scheduling/shared/hooks/form-context";

/**
 * The form's submit button: disabled while the form is submitting or cannot
 * submit, with a spinner during the round trip. Registered on `useAppForm` so
 * it is used as `<form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>`.
 */
export function SubmitButton({
  children,
  disabled,
  ...buttonProps
}: Omit<React.ComponentProps<typeof Button>, "type">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}>
      {({ canSubmit, isSubmitting }) => (
        <Button type="submit" disabled={disabled || !canSubmit || isSubmitting} {...buttonProps}>
          {isSubmitting ? <Spinner /> : null}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
