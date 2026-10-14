"use client";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFieldContext } from "@/features/scheduling/shared/hooks/form-context";
import { toFieldErrors } from "@/features/scheduling/shared/lib/field-errors";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * A labelled `<select>` bound to the enclosing TanStack Form field. Native on
 * purpose: these are data-driven lists (departments, roles, punch types) where
 * the browser control is the most robust and accessible choice.
 */
export function NativeSelectField({
  label,
  description,
  options,
  placeholder,
  onValueChange,
  className,
  ...selectProps
}: {
  label: string;
  description?: string;
  options: SelectOption[];
  /** Rendered as a first, empty-valued option ("— any —", "Select…"). */
  placeholder?: string;
  /** Called after the field value changes, for dependent fields (department → roles). */
  onValueChange?: (value: string) => void;
} & Omit<React.ComponentProps<typeof NativeSelect>, "value" | "onChange" | "onBlur" | "name" | "id">) {
  const field = useFieldContext<string>();
  const errors = toFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;
  return (
    <Field data-invalid={invalid || undefined} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <NativeSelect
        id={field.name}
        name={field.name}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => {
          field.handleChange(e.target.value);
          onValueChange?.(e.target.value);
        }}
        aria-invalid={invalid || undefined}
        className="w-full"
        {...selectProps}
      >
        {placeholder !== undefined ? <NativeSelectOption value="">{placeholder}</NativeSelectOption> : null}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={invalid ? errors : undefined} />
    </Field>
  );
}
