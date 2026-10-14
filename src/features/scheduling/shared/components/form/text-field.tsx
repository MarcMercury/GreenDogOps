"use client";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFieldContext } from "@/features/scheduling/shared/hooks/form-context";
import { toFieldErrors } from "@/features/scheduling/shared/lib/field-errors";

/**
 * A labelled text-like input bound to the enclosing TanStack Form field. The
 * value stays a string whatever `type` is (number, time, date, color…) — the
 * zod schema does the coercion, on the client and again in the action.
 */
export function TextField({
  label,
  description,
  className,
  ...inputProps
}: {
  label: string;
  description?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "name" | "id">) {
  const field = useFieldContext<string>();
  const errors = toFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;
  return (
    <Field data-invalid={invalid || undefined} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={invalid || undefined}
        {...inputProps}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={invalid ? errors : undefined} />
    </Field>
  );
}
