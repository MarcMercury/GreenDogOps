import { describe, expect, it } from "vitest";
import {
  likeToRegExp,
  similarTags,
  tagFilterLiterals,
  tagMismatchError,
  unmatchedTagFilters,
} from "./smart-tags";

const VOCAB = ["ap", "alert", "code *101*", "code *501*", "code *tc*", "google search", "yelp"];

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
    expect(similarTags("code 101", VOCAB)[0]).toBe("code *101*");
    const msg = tagMismatchError([{ literal: "code_101", pattern: false }], VOCAB);
    expect(msg).toContain("'code_101' matches no tag; the real tag is probably 'code *101*'");
    expect(msg).toContain("excludes NOBODY");
  });
});
