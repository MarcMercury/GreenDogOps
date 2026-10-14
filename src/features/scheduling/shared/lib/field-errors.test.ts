import { describe, expect, it } from "vitest";
import { toFieldErrors } from "@/features/scheduling/shared/lib/field-errors";

describe("toFieldErrors", () => {
  it("keeps zod issues and plain strings, drops empties and junk", () => {
    expect(
      toFieldErrors([
        { message: "Name is required.", path: ["name"] },
        "Too long",
        "",
        undefined,
        null,
        { code: "custom" },
        42,
      ]),
    ).toEqual([{ message: "Name is required." }, { message: "Too long" }]);
  });

  it("returns an empty list for no errors", () => {
    expect(toFieldErrors([])).toEqual([]);
  });
});
