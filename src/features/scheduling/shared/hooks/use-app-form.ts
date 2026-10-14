import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "@/features/scheduling/shared/hooks/form-context";
import { CheckboxField } from "@/features/scheduling/shared/components/form/checkbox-field";
import { NativeSelectField } from "@/features/scheduling/shared/components/form/native-select-field";
import { SubmitButton } from "@/features/scheduling/shared/components/form/submit-button";
import { TextField } from "@/features/scheduling/shared/components/form/text-field";
import { TextareaField } from "@/features/scheduling/shared/components/form/textarea-field";

/**
 * The Scheduling form hook (TanStack Form "form composition").
 *
 * ```tsx
 * const form = useAppForm({
 *   defaultValues: { name: "" },
 *   validators: { onSubmit: formValidator<{ name: string }>(departmentSchema) },
 *   onSubmit: async ({ value }) => toastResult(await saveDepartment(value), "Department saved"),
 *   onSubmitInvalid: toastInvalidForm,
 * });
 * <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
 *   <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
 *   <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
 * </form>
 * ```
 *
 * Field components bind themselves to the field through `useFieldContext`, so
 * a form never wires `value` / `onChange` by hand; the server action re-parses
 * the same schema (`parseInput`) because the browser is not trusted.
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    NativeSelectField,
    CheckboxField,
  },
  formComponents: {
    SubmitButton,
  },
});
