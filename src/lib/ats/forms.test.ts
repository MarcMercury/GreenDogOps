import { describe, expect, it } from "vitest";
import {
  answeredWithSections,
  answerText,
  checkedOptions,
  fieldTypeAllowed,
  formFieldProblems,
  formMatchesTitle,
  newField,
  parseFields,
  pickInterviewGuide,
  readInterviewResponses,
  responsesAsFields,
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

describe("interview guides", () => {
  const guide = (name: string, interview_types: string[], job_titles: string[] = []) => ({
    name,
    interview_types,
    job_titles,
  });
  const phone = guide("Phone Screen", ["phone_screen", "virtual"]);
  const shadow = guide("Shadow Day", ["in_person", "working_interview"]);
  const csrPhone = guide("CSR Phone Screen", ["phone_screen"], ["CSR"]);
  const anything = guide("General notes", []);

  it("pickInterviewGuide matches the interview type", () => {
    expect(pickInterviewGuide([phone, shadow], "working_interview", "CSR")).toBe(shadow);
    expect(pickInterviewGuide([phone, shadow], "virtual", null)).toBe(phone);
    expect(pickInterviewGuide([phone, shadow], "final", "CSR")).toBeNull();
  });

  it("pickInterviewGuide prefers a job-specific guide, then a typed one", () => {
    expect(pickInterviewGuide([phone, csrPhone], "phone_screen", "csr")).toBe(csrPhone);
    expect(pickInterviewGuide([phone, csrPhone], "phone_screen", "DVM")).toBe(phone);
    expect(pickInterviewGuide([anything, phone], "phone_screen", "DVM")).toBe(phone);
    expect(pickInterviewGuide([anything, phone], "final", "DVM")).toBe(anything);
    expect(pickInterviewGuide([anything, phone], null, null)).toBe(anything);
  });

  it("guides can't ask for file uploads", () => {
    expect(fieldTypeAllowed("interview", "file")).toBe(false);
    expect(fieldTypeAllowed("interview", "checkboxes")).toBe(true);
    expect(fieldTypeAllowed("screening", "file")).toBe(true);
  });

  it("readInterviewResponses snapshots each question with its answer", () => {
    const fields = [
      f({ id: "sec", type: "section", label: "Core" }),
      f({ id: "exp", type: "long_text", label: "Experience", description: "tip" }),
      f({ id: "tools", type: "checkboxes", label: "Tools", options: ["ezyVet", "Slack"] }),
      f({ id: "ft", type: "multiple_choice", label: "FT?", options: ["Full-time", "Part-time"] }),
      f({ id: "cv", type: "file", label: "CV" }),
    ];
    const fd = new FormData();
    fd.append("a_exp", "  3 years GP  ");
    fd.append("a_tools", "ezyVet");
    fd.append("a_tools", "Slack");
    fd.append("a_sec", "ignored");
    const out = readInterviewResponses(fields, fd);
    expect(out.map((r) => r.id)).toEqual(["sec", "exp", "tools", "ft"]);
    expect(out[0]).toMatchObject({ type: "section", question: "Core", answer: null });
    expect(out[1]).toMatchObject({ type: "long_text", answer: "3 years GP", description: "tip" });
    expect(out[1]).not.toHaveProperty("options");
    expect(out[2]).toMatchObject({ answer: "ezyVet, Slack", options: ["ezyVet", "Slack"] });
    expect(out[3].answer).toBeNull();
  });

  it("responsesAsFields round-trips a snapshot and upgrades legacy responses", () => {
    const fields = responsesAsFields([
      { id: "tools", question: "Tools", answer: "Slack", type: "checkboxes", options: ["ezyVet", "Slack"] },
      { question: "Old CSR question", answer: "notes" },
      { question: "Another", answer: null },
    ]);
    expect(fields[0]).toMatchObject({ id: "tools", type: "checkboxes", options: ["ezyVet", "Slack"] });
    expect(fields[1]).toMatchObject({ id: "legacy_1", type: "long_text", label: "Old CSR question", options: [] });
    expect(fields[2].id).toBe("legacy_2");
  });

  it("checkedOptions reads a stored checkboxes answer", () => {
    expect(checkedOptions("ezyVet, Slack", ["ezyVet", "Slack", "Docs"])).toEqual(["ezyVet", "Slack"]);
    expect(checkedOptions(null, ["a"])).toEqual([]);
  });

  it("answeredWithSections keeps headings only above answered questions", () => {
    const rows = [
      { question: "A", answer: null, type: "section" },
      { question: "a1", answer: "yes" },
      { question: "B", answer: null, type: "section" },
      { question: "b1", answer: "  " },
      { question: "C", answer: null, type: "section" },
      { question: "c1", answer: null },
      { question: "c2", answer: "ok" },
    ];
    expect(answeredWithSections(rows).map((r) => r.question)).toEqual(["A", "a1", "C", "c2"]);
  });
});
