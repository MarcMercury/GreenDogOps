import { describe, expect, it } from "vitest";
import { requiredText, intInRange, z } from "@/lib/validation/form";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";

const schema = z.object({
  name: requiredText(10, "Name"),
  sort_order: intInRange(0, 99, 0),
});

describe("formValidator", () => {
  it("validates through the Standard Schema interface and keeps issue paths for field mapping", () => {
    const validator = formValidator<{ name: string; sort_order: string }>(schema);
    const result = validator["~standard"].validate({ name: "   ", sort_order: "500" });
    if (result instanceof Promise) throw new Error("expected a synchronous result");
    expect("issues" in result && result.issues?.length).toBe(2);
    const paths = (result.issues ?? []).map((i) => (i.path ?? []).map((p) => (typeof p === "object" ? p.key : p)).join("."));
    expect(paths).toEqual(expect.arrayContaining(["name", "sort_order"]));
  });

  it("accepts the strings a form actually submits", () => {
    const validator = formValidator<{ name: string; sort_order: string }>(schema);
    const result = validator["~standard"].validate({ name: "Surgery", sort_order: "3" });
    if (result instanceof Promise) throw new Error("expected a synchronous result");
    expect("issues" in result ? result.issues : undefined).toBeUndefined();
  });
});
