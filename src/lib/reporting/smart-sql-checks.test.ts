import { describe, expect, it } from "vitest";
import {
  PROBLEM_SPEC,
  comparedDates,
  coverageError,
  coverageGaps,
  coverageWarning,
  likeToRegExp,
  notInSubqueryProblem,
  rawTagTextProblem,
  similarValues,
  tagFilterLiterals,
  tagMismatchError,
  unmatchedFilters,
  unmatchedTagFilters,
  vocabMismatchError,
} from "./smart-sql-checks";

const VOCAB = ["ap", "alert", "code *101*", "code *501*", "code *tc*", "google search", "yelp"];
const PROBLEMS = ["*AP REQUIRED", "*AP Recommended", "FEAR FREE PVQ", "*SEDATION", "*CARDIO", "Heart Murmur"];

// The query Ask Ziggy ran on 2026-10-07 for "now remove any 101 and 501
// clients/pets": the guessed spellings matched nothing, so nobody was removed.
const LOGGED_SQL = `SELECT ec.full_name FROM ezyvet_contact AS ec
WHERE ec.is_customer IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM report_contact_tag AS rct
    WHERE rct.contact_code = ec.contact_code
      AND rct.tag_norm IN ('code_101', 'code_501')
  )`;

describe("tagFilterLiterals", () => {
  it("reads every literal in an IN list", () => {
    expect(tagFilterLiterals(LOGGED_SQL).map((f) => f.literal)).toEqual(["code_101", "code_501"]);
  });

  it("reads OR'd equality, lower() wrappers and <>", () => {
    const sql = `select 1 from report_contact_tag rct where (rct.tag_norm = 'code 101' or lower(rct.tag) = lower('Code 501')) and tag_norm <> 'yelp'`;
    expect(tagFilterLiterals(sql).map((f) => f.literal)).toEqual(["code 101", "Code 501", "yelp"]);
  });

  it("reads = ANY(ARRAY[...]) and LIKE patterns", () => {
    const sql = `select 1 from report_contact_tag where tag_norm = any(array['ap','alert']) or tag_norm not ilike '%101%'`;
    expect(tagFilterLiterals(sql)).toEqual([
      { literal: "ap", pattern: false },
      { literal: "alert", pattern: false },
      { literal: "%101%", pattern: true },
    ]);
  });

  it("handles doubled quotes inside a literal", () => {
    const sql = `select 1 from report_contact_tag where tag_norm = 'answer needed please ask client''s owner'`;
    expect(tagFilterLiterals(sql)[0].literal).toBe("answer needed please ask client's owner");
  });

  it("ignores tag_type / tag_source and SQL that never touches the tag views", () => {
    expect(
      tagFilterLiterals(`select 1 from report_contact_tag where tag_type = 'pet_tag' and tag_source = 'x'`),
    ).toEqual([]);
    expect(tagFilterLiterals(`select 1 from referral_partners where tag = 'vip'`)).toEqual([]);
  });

  it("ignores a subquery on the right-hand side", () => {
    expect(
      tagFilterLiterals(`select 1 from report_contact_tag where tag_norm in (select tag_norm from report_contact_tag_summary)`),
    ).toEqual([]);
  });
});

describe("unmatchedTagFilters", () => {
  it("flags the guessed 101/501 spellings from the logged query", () => {
    expect(unmatchedTagFilters(LOGGED_SQL, VOCAB).map((f) => f.literal)).toEqual([
      "code_101",
      "code_501",
    ]);
  });

  it("flags 'code 101' without the asterisks", () => {
    const sql = `select 1 from report_contact_tag rct where rct.tag_norm in ('code 101', 'code 501')`;
    expect(unmatchedTagFilters(sql, VOCAB)).toHaveLength(2);
  });

  it("accepts the real spellings, case-insensitively", () => {
    const sql = `select 1 from report_contact_tag rct where rct.tag_norm in ('code *101*', 'Code *501*')`;
    expect(unmatchedTagFilters(sql, VOCAB)).toEqual([]);
  });

  it("accepts a LIKE pattern that matches a real tag and flags one that does not", () => {
    expect(unmatchedTagFilters(`select 1 from report_contact_tag where tag_norm ilike '%101%'`, VOCAB)).toEqual([]);
    expect(
      unmatchedTagFilters(`select 1 from report_contact_tag where tag_norm ilike '%code_101%'`, VOCAB),
    ).toEqual([{ literal: "%code_101%", pattern: true }]);
  });

  it("checks nothing when the vocabulary could not be loaded", () => {
    expect(unmatchedTagFilters(LOGGED_SQL, [])).toEqual([]);
  });
});

describe("master_problems filters", () => {
  it("accepts ILIKE on a real item, through coalesce() too", () => {
    const sql = `select 1 from ezyvet_animal ea where ea.master_problems ilike '%AP Required%' and coalesce(ea.master_problems, '') not ilike '%sedation%'`;
    expect(unmatchedFilters(sql, PROBLEM_SPEC, PROBLEMS)).toEqual([]);
  });

  it("flags a pattern that matches no item", () => {
    const sql = `select 1 from ezyvet_animal where master_problems ilike '%AP-Required%'`;
    expect(unmatchedFilters(sql, PROBLEM_SPEC, PROBLEMS)).toEqual([{ literal: "%AP-Required%", pattern: true }]);
  });

  it("flags = on the comma-joined list even when the item exists", () => {
    const sql = `select 1 from ezyvet_animal where master_problems = '*AP REQUIRED'`;
    const bad = unmatchedFilters(sql, PROBLEM_SPEC, PROBLEMS);
    expect(bad).toEqual([{ literal: "*AP REQUIRED", pattern: false }]);
    expect(vocabMismatchError(PROBLEM_SPEC, bad, PROBLEMS)).toContain("ENTIRE list");
  });

  it("does not check master_problems on other tables", () => {
    const sql = `select 1 from medical_board_row where master_problems ilike '%nothing%'`;
    expect(unmatchedFilters(sql, PROBLEM_SPEC, PROBLEMS)).toEqual([]);
  });
});

describe("likeToRegExp", () => {
  it("treats % and _ as wildcards and escapes regex characters", () => {
    expect(likeToRegExp("code *1_1*").test("code *101*")).toBe(true);
    expect(likeToRegExp("%$169").test("tag disabled gdd $169")).toBe(true);
    expect(likeToRegExp("100\\%").test("100%")).toBe(true);
    expect(likeToRegExp("100\\%").test("1000")).toBe(false);
  });
});

describe("tagMismatchError", () => {
  it("points the model at the real spelling", () => {
    expect(similarValues("code 101", VOCAB)[0]).toBe("code *101*");
    const msg = tagMismatchError([{ literal: "code_101", pattern: false }], VOCAB);
    expect(msg).toContain("'code_101' matches no tag; the real value is probably 'code *101*'");
    expect(msg).toContain("excludes NOBODY");
  });
});

describe("rawTagTextProblem", () => {
  it("rejects LIKE on the comma-joined contact_tags text — the 2026-09-17 query", () => {
    expect(rawTagTextProblem(`select 1 from ezyvet_aged_receivable ear where ear.contact_tags ILIKE '%101%'`)).toContain(
      "report_contact_tag",
    );
    expect(rawTagTextProblem(`where NOT (lars.contact_tags ILIKE '%Code *101*%')`)).not.toBeNull();
    expect(rawTagTextProblem(`where contact_tags not ilike '%x%'`)).not.toBeNull();
  });

  it("allows selecting the column", () => {
    expect(rawTagTextProblem(`select contact_code, contact_tags from ezyvet_contact`)).toBeNull();
  });
});

describe("notInSubqueryProblem", () => {
  it("rejects NOT IN (SELECT ...) — the 2026-09-16 lapsed-client query", () => {
    const sql = `select 1 from ezyvet_contact ec where ec.contact_code NOT IN (
      SELECT DISTINCT eil.client_contact_code FROM ezyvet_invoice_line eil)`;
    expect(notInSubqueryProblem(sql)).toContain("NOT EXISTS");
  });

  it("allows NOT IN over a literal list and NOT EXISTS", () => {
    expect(notInSubqueryProblem(`select 1 from x where a not in ('a','b')`)).toBeNull();
    expect(notInSubqueryProblem(`select 1 from x where not exists (select 1 from y)`)).toBeNull();
  });
});

describe("coverage", () => {
  it("reads date literals from comparisons, BETWEEN and casts", () => {
    const sql = `where eil.line_date >= '2024-09-01' and line_date between date '2022-01-01' and '2024-12-31'::date`;
    expect(comparedDates(sql, "line_date")).toEqual(["2024-09-01", "2022-01-01", "2024-12-31"]);
  });

  it("flags an invoice-line window that starts before 2025-01-02", () => {
    const sql = `select 1 from ezyvet_invoice_line eil where eil.line_date BETWEEN '2024-09-01' AND '2025-09-01'`;
    expect(coverageGaps(sql)).toEqual([
      { label: "Billed lines (ezyvet_invoice_line)", start: "2025-01-02", earliest: "2024-09-01" },
    ]);
    expect(coverageError(coverageGaps(sql))).toContain("last_invoiced");
    expect(coverageWarning(coverageGaps(sql))).toContain("billed lines only go back to 2025-01-02");
  });

  it("does not flag last_invoiced windows or covered dates", () => {
    expect(
      coverageGaps(`select 1 from ezyvet_contact ec where ec.last_invoiced between '2022-01-01' and '2024-08-31'`),
    ).toEqual([]);
    expect(
      coverageGaps(`select 1 from ezyvet_invoice_line where line_date >= '2025-01-02'`),
    ).toEqual([]);
  });

  it("flags appointment records before November 2024 but not when appt_date is ambiguous", () => {
    expect(
      coverageGaps(`select 1 from report_appointment_detail where appt_date >= '2024-01-01'`),
    ).toHaveLength(1);
    expect(
      coverageGaps(`select 1 from report_appointment_detail where appt_date >= '2025-01-01'`),
    ).toEqual([]);
    expect(
      coverageGaps(
        `select 1 from report_appointment_detail d join ezyvet_cancelled_appointment c using (appt_date) where appt_date >= '2024-01-01'`,
      ),
    ).toEqual([]);
  });
});
