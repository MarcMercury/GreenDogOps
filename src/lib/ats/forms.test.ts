import { describe, expect, it } from "vitest";
import {
  answerText,
  formFieldProblems,
  formMatchesTitle,
  newField,
  parseFields,
  slugify,
  validateAnswers,
  type RecruitingFormField,
} from "./forms";

const f = (p: Partial<RecruitingFormField> & Pick<RecruitingFormField, "id" | "type">): RecruitingFormField => ({
  label: p.id,
  description: null,
  required: false,
  options: [],
  ...p,
});

describe("parseFields", () => {
  it("drops malformed, duplicate and reserved questions", () => {
    const parsed = parseFields([
      { id: "q1", type: "short_text", label: "  Name  ", required: true },
      { id: "q1", type: "long_text", label: "dupe" },
      { id: "email", type: "short_text", label: "reserved core id" },
      { id: "q2", type: "bogus", label: "x" },
      { id: "q3", type: "checkboxes", label: "Days", options: ["Mon", "Mon", " Tue ", ""] },
      { id: "q4", type: "section", label: "Part 2", required: true },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(["q1", "q3", "q4"]);
    expect(parsed[0].label).toBe("Name");
    expect(parsed[1].options).toEqual(["Mon", "Tue"]);
    expect(parsed[2].required).toBe(false);
  });
});

describe("formFieldProblems", () => {
  it("needs titles and options", () => {
    expect(formFieldProblems([f({ id: "a", type: "dropdown", label: "" })])).toHaveLength(2);
    expect(formFieldProblems([f({ id: "a", type: "dropdown", options: ["x"] })])).toEqual([]);
  });
});

describe("validateAnswers", () => {
  const fields = [
    f({ id: "name", type: "short_text", required: true }),
    f({ id: "days", type: "checkboxes", options: ["Mon", "Tue"], required: true }),
    f({ id: "pick", type: "dropdown", options: ["A", "B"] }),
    f({ id: "ok", type: "yes_no", required: true }),
    f({ id: "n", type: "number" }),
    f({ id: "d", type: "date" }),
    f({ id: "cv", type: "file", required: true }),
    f({ id: "sec", type: "section" }),
  ];

  it("accepts a complete submission", () => {
    const res = validateAnswers(
      fields,
      { name: " Jane ", days: ["Mon", "Tue"], pick: "B", ok: "Yes", n: "3", d: "2026-10-20" },
      new Set(["cv"]),
    );
    expect(res.errors).toEqual({});
    expect(res.answers).toEqual({ name: "Jane", days: ["Mon", "Tue"], pick: "B", ok: "Yes", n: "3", d: "2026-10-20" });
  });

  it("flags missing and invalid answers", () => {
    const res = validateAnswers(fields, { days: ["Wed"], pick: "Z", ok: "Maybe", n: "abc", d: "10/20" });
    expect(Object.keys(res.errors).sort()).toEqual(["cv", "d", "days", "n", "name", "ok", "pick"]);
  });
});

describe("helpers", () => {
  it("slugify", () => {
    expect(slugify("CSR Screening — Van Nuys!")).toBe("csr-screening-van-nuys");
  });

  it("answerText", () => {
    expect(answerText(["a", "b"])).toBe("a, b");
    expect(answerText({ document_id: "x", file_name: "cv.pdf" })).toBe("📎 cv.pdf");
    expect(answerText(null)).toBeNull();
  });

  it("formMatchesTitle", () => {
    expect(formMatchesTitle({ job_titles: ["CSR", "Remote CSR"] }, "csr")).toBe(true);
    expect(formMatchesTitle({ job_titles: ["DVM"] }, "CSR")).toBe(false);
  });

  it("newField gives choice questions a starter option", () => {
    expect(newField("dropdown").options).toEqual(["Option 1"]);
    expect(newField("short_text").options).toEqual([]);
  });
});
