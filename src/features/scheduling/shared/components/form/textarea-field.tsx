"use client";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useFieldContext } from "@/features/scheduling/shared/hooks/form-context";
import { toFieldErrors } from "@/features/scheduling/shared/lib/field-errors";

/** A labelled textarea bound to the enclosing TanStack Form field. */
export function TextareaField({
  label,
  description,
  className,
  ...textareaProps
}: {
  label: string;
  description?: string;
} & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur" | "name" | "id">) {
  const field = useFieldContext<string>();
  const errors = toFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;
  return (
    <Field data-invalid={invalid || undefined} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Textarea
        id={field.name}
        name={field.name}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={invalid || undefined}
        {...textareaProps}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={invalid ? errors : undefined} />
    </Field>
  );
}
