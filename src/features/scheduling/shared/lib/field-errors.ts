/** What shadcn's `FieldError` renders: one message per issue. */
export interface FieldErrorMessage {
  message?: string;
}

/**
 * TanStack Form keeps a field's errors as `unknown[]`: Standard Schema issues
 * (`{ message, path }`) from a zod validator, plain strings from a hand-written
 * one, or objects an async validator returned. Normalise them to what
 * `<FieldError errors={…}>` expects, dropping anything without a message.
 */
export function toFieldErrors(errors: ReadonlyArray<unknown>): FieldErrorMessage[] {
  const out: FieldErrorMessage[] = [];
  for (const e of errors) {
    if (e == null) continue;
    if (typeof e === "string") {
      if (e) out.push({ message: e });
      continue;
    }
    if (typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
      out.push({ message: (e as { message: string }).message });
    }
  }
  return out;
}
