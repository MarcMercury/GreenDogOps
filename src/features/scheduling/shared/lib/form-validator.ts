import type { StandardSchemaV1 } from "@tanstack/react-form";
import type { z } from "@/lib/validation/form";

/**
 * Use one of the feature `schema/` objects as a TanStack Form validator.
 *
 * The schemas are built from the `src/lib/validation/form.ts` helpers, which
 * wrap every field in `z.preprocess(blankToNull, …)` so a Server Action can
 * accept raw form strings. That makes their *input* type `unknown`, and
 * TanStack Form types a validator as `StandardSchemaV1<TFormValues, unknown>`,
 * so the compiler refuses the schema against string-valued `defaultValues`.
 * At runtime a Standard Schema validates any input, and a failing issue's
 * `path` is mapped onto the matching field, so the cast is the whole adapter.
 *
 * Keeping one schema per input shape means the browser and the action agree on
 * what is valid; the action still re-parses, because the client is untrusted.
 */
export function formValidator<TValues>(schema: z.ZodType): StandardSchemaV1<TValues, unknown> {
  return schema as unknown as StandardSchemaV1<TValues, unknown>;
}
