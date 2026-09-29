import { z } from "zod";

/**
 * Validation for Server Actions.
 *
 * Every action in this app receives a `FormData` from the browser and pulls
 * fields out by name. Nothing stops a caller POSTing a 50,000-character note, a
 * `day_of_week` of 99, or a `role_id` that is not a UUID -- Server Actions are
 * ordinary HTTP endpoints, so "the form only offers valid options" is a
 * statement about the UI, not about what arrives.
 *
 * Parsing here rejects that at the boundary, before it reaches Postgres. Note
 * what this is NOT for: the Supabase client parameterises every query, so SQL
 * injection is not the risk being addressed. The risk is bad data -- silently
 * truncated text, out-of-range numbers, rows pointing at nothing -- and the
 * confusing bugs it produces weeks later.
 */

// --- FormData primitives ---------------------------------------------------
//
// Browsers submit every field as a string, and an untouched input arrives as ""
// rather than being absent. These helpers normalise that: blank becomes null,
// so "not filled in" and "explicitly cleared" are the same thing, which is what
// the database columns already expect.

const blankToNull = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Optional trimmed text with a length cap. Blank becomes null. */
export const optionalText = (max = 500) =>
  z.preprocess(blankToNull, z.string().max(max).nullable().default(null));

/** Required trimmed text. Rejects a field that was left blank. */
export const requiredText = (max = 500, label = "This field") =>
  z.preprocess(
    blankToNull,
    z.string({ message: `${label} is required.` }).min(1, `${label} is required.`).max(max),
  );

export const optionalUuid = z.preprocess(
  blankToNull,
  z.string().uuid("Not a valid id.").nullable().default(null),
);

export const requiredUuid = (label = "id") =>
  z.preprocess(
    blankToNull,
    z.string({ message: `Missing ${label}.` }).uuid(`Not a valid ${label}.`),
  );

/** Whole number in a range. Accepts the strings FormData actually delivers. */
export const intInRange = (min: number, max: number, fallback?: number) =>
  z.preprocess((v) => {
    const s = blankToNull(v);
    if (s === null) return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : s;
  }, z.number().int().min(min).max(max));

/** Checkbox. Unchecked boxes are simply absent from FormData. */
export const checkbox = z.preprocess(
  (v) => v === "on" || v === "true" || v === "1" || v === true,
  z.boolean(),
);

/** "YYYY-MM-DD", or null. */
export const optionalDate = z.preprocess(
  blankToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.").nullable().default(null),
);

export const requiredDate = (label = "Date") =>
  z.preprocess(
    blankToNull,
    z.string({ message: `${label} is required.` })
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a YYYY-MM-DD date.`),
  );

/** "HH:MM" or "HH:MM:SS", or null. */
export const optionalTime = z.preprocess(
  blankToNull,
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use a HH:MM time.")
    .nullable().default(null),
);

export const optionalEmail = z.preprocess(
  blankToNull,
  z.string().email("Not a valid email address.").max(254).nullable().default(null),
);

/** One of a fixed set, e.g. a database enum. Blank becomes null. */
export const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable().default(null));

// --- Entry point -----------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Turn a FormData into a validated object, or into the same
 * `{ ok: false, error }` shape the actions already return, so a failure renders
 * through each form's existing error path with no extra wiring.
 *
 * Repeated field names collapse to an array, which is how multi-selects and
 * checkbox groups arrive.
 */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): ParseResult<z.infer<S>> {
  const raw: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(formData.keys())) {
    const all = formData.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  // Surface one clear message rather than a dump of every issue: these strings
  // are shown to end users, not developers.
  const first = parsed.error.issues[0];
  const field = first.path.join(".");
  const message =
    first.message === "Required" && field
      ? `${field} is required.`
      : field
        ? `${field}: ${first.message}`
        : first.message;
  return { ok: false, error: message };
}

/** Same as parseForm for values that did not come from a form. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ParseResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  const field = first.path.join(".");
  return { ok: false, error: field ? `${field}: ${first.message}` : first.message };
}

export { z };
