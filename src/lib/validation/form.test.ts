import { describe, expect, it } from "vitest";
import {
  checkbox,
  intInRange,
  optionalDate,
  optionalEmail,
  optionalEnum,
  optionalText,
  optionalTime,
  optionalUuid,
  parseForm,
  requiredText,
  requiredUuid,
  z,
} from "./form";

/** Build a FormData the way a browser would, including blank untouched inputs. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.append(k, v);
  }
  return fd;
}

const UUID = "3f1c9b2e-8a4d-4c7e-9f1a-2b3c4d5e6f70";

describe("FormData primitives", () => {
  it("treats a blank input as null rather than an empty string", () => {
    // An untouched text input posts "", which must not be stored as "".
    const schema = z.object({ label: optionalText(50) });
    const r = parseForm(schema, form({ label: "   " }));
    expect(r).toEqual({ ok: true, data: { label: null } });
  });

  it("trims surrounding whitespace", () => {
    const schema = z.object({ label: optionalText(50) });
    const r = parseForm(schema, form({ label: "  Surgery Tech  " }));
    expect(r.ok && r.data.label).toBe("Surgery Tech");
  });

  it("rejects text beyond the column's limit", () => {
    const schema = z.object({ note: optionalText(10) });
    const r = parseForm(schema, form({ note: "x".repeat(11) }));
    expect(r.ok).toBe(false);
  });

  it("rejects a required field left blank", () => {
    const schema = z.object({ name: requiredText(50, "Name") });
    const r = parseForm(schema, form({ name: "" }));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("required");
  });

  it("rejects an id that is not a uuid", () => {
    const schema = z.object({ role_id: requiredUuid("role id") });
    expect(parseForm(schema, form({ role_id: "42" })).ok).toBe(false);
    expect(parseForm(schema, form({ role_id: UUID })).ok).toBe(true);
  });

  it("allows an optional uuid to be absent but not malformed", () => {
    const schema = z.object({ role_id: optionalUuid });
    expect(parseForm(schema, form({ role_id: "" }))).toEqual({
      ok: true,
      data: { role_id: null },
    });
    expect(parseForm(schema, form({ role_id: "nope" })).ok).toBe(false);
  });
});

describe("numbers", () => {
  it("accepts the strings FormData actually delivers", () => {
    const schema = z.object({ day: intInRange(0, 6) });
    expect(parseForm(schema, form({ day: "3" })).ok).toBe(true);
  });

  it("rejects out-of-range values", () => {
    // day_of_week is 0-6; 9 would produce a row no query can ever find.
    const schema = z.object({ day: intInRange(0, 6) });
    expect(parseForm(schema, form({ day: "9" })).ok).toBe(false);
    expect(parseForm(schema, form({ day: "-1" })).ok).toBe(false);
  });

  it("rejects text that is not a number", () => {
    const schema = z.object({ day: intInRange(0, 6) });
    expect(parseForm(schema, form({ day: "Tuesday" })).ok).toBe(false);
  });

  it("uses the fallback when the field is blank", () => {
    const schema = z.object({ sort: intInRange(0, 9999, 9999) });
    const r = parseForm(schema, form({ sort: "" }));
    expect(r.ok && r.data.sort).toBe(9999);
  });
});

describe("checkboxes", () => {
  it("is false when absent, because browsers omit unchecked boxes", () => {
    const schema = z.object({ is_active: checkbox });
    const r = parseForm(schema, form({}));
    expect(r.ok && r.data.is_active).toBe(false);
  });

  it("is true for the value a checked box posts", () => {
    const schema = z.object({ is_active: checkbox });
    expect(parseForm(schema, form({ is_active: "on" })).ok).toBe(true);
    const r = parseForm(schema, form({ is_active: "on" }));
    expect(r.ok && r.data.is_active).toBe(true);
  });
});

describe("dates, times, emails, enums", () => {
  it("accepts ISO dates and rejects other formats", () => {
    const schema = z.object({ d: optionalDate });
    expect(parseForm(schema, form({ d: "2026-09-29" })).ok).toBe(true);
    expect(parseForm(schema, form({ d: "09/29/2026" })).ok).toBe(false);
  });

  it("accepts HH:MM and HH:MM:SS but not a 25th hour", () => {
    const schema = z.object({ t: optionalTime });
    expect(parseForm(schema, form({ t: "09:30" })).ok).toBe(true);
    expect(parseForm(schema, form({ t: "09:30:00" })).ok).toBe(true);
    expect(parseForm(schema, form({ t: "25:00" })).ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    const schema = z.object({ email: optionalEmail });
    expect(parseForm(schema, form({ email: "not-an-email" })).ok).toBe(false);
    expect(parseForm(schema, form({ email: "a@b.com" })).ok).toBe(true);
  });

  it("only accepts declared enum values", () => {
    // Guards database enums: an unknown status would fail at insert time with a
    // Postgres error instead of a message anyone can act on.
    const schema = z.object({ status: optionalEnum(["draft", "published"] as const) });
    expect(parseForm(schema, form({ status: "published" })).ok).toBe(true);
    expect(parseForm(schema, form({ status: "deleted" })).ok).toBe(false);
  });
});

describe("parseForm", () => {
  it("collapses repeated fields into an array for multi-selects", () => {
    const schema = z.object({ location_ids: z.array(z.string()) });
    const r = parseForm(schema, form({ location_ids: [UUID, UUID] }));
    expect(r.ok && r.data.location_ids).toHaveLength(2);
  });

  it("returns the ok/error shape the actions already use", () => {
    const schema = z.object({ name: requiredText(10, "Name") });
    const bad = parseForm(schema, form({ name: "" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(typeof bad.error).toBe("string");
  });

  it("ignores fields the schema does not declare", () => {
    // Extra fields must not reach the database as unexpected columns.
    const schema = z.object({ name: requiredText(20, "Name") });
    const r = parseForm(schema, form({ name: "Ok", is_admin: "true" }));
    expect(r.ok && r.data).toEqual({ name: "Ok" });
  });
});
