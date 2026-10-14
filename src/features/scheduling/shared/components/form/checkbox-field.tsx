"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { useFieldContext } from "@/features/scheduling/shared/hooks/form-context";
import { toFieldErrors } from "@/features/scheduling/shared/lib/field-errors";

/** A checkbox with its label (and optional help text) bound to a boolean TanStack Form field. */
export function CheckboxField({
  label,
  description,
  disabled,
  className,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  const field = useFieldContext<boolean>();
  const errors = toFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;
  return (
    <Field orientation="horizontal" data-invalid={invalid || undefined} className={className}>
      <Checkbox
        id={field.name}
        name={field.name}
        checked={!!field.state.value}
        disabled={disabled}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
        onBlur={field.handleBlur}
        aria-invalid={invalid || undefined}
      />
      <FieldContent>
        <FieldLabel htmlFor={field.name} className="font-normal">
          {label}
        </FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
        <FieldError errors={invalid ? errors : undefined} />
      </FieldContent>
    </Field>
  );
}
