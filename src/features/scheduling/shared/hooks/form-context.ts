import { createFormHookContexts } from "@tanstack/react-form";

/**
 * The contexts TanStack Form's composition API hangs field and form state on.
 * Kept in their own module so the field components (which read
 * `useFieldContext`) and `use-app-form.ts` (which registers those components)
 * don't import each other in a cycle.
 */
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
