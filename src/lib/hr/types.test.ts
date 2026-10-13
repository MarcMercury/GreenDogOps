import { describe, expect, it } from "vitest";
import {
  COMPENSATION_FIELDS,
  PRIVATE_EMPLOYMENT_FIELDS,
  PRIVATE_PERSON_FIELDS,
  redactCompensation,
  redactPrivate,
  isRosterStatus,
  ROSTER_STATUS_LABELS,
  STATUS_LABELS,
  type RosterRow,
} from "./types";

function row(): RosterRow {
  return {
    id: "p1",
    status: "employee",
    status_changed_at: "",
    first_name: "Ada",
    last_name: "Lovelace",
    grid_name: "Ada",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone_mobile: "(555) 555-0100",
    phone_home: "(555) 555-0101",
    phone_other: "(555) 555-0102",
    date_of_birth: "1990-01-01",
    postal_code: "90210",
    work_location_type: "in_house",
    opportunity_type: null,
    avatar_url: null,
    is_active: true,
    notes: "private note",
    source_contact_id: null,
    created_at: "",
    updated_at: "",
    person_employment: {
      person_id: "p1",
      position_id: null,
      location_id: null,
      preferred_location_id: null,
      offer_title: "RVT",
      adp_job_title: "RVT",
      flsa_status: "non_exempt",
      work_schedule: "full_time",
      schedule_type: null,
      days_per_week: 5,
      hire_date: "2020-01-01",
      original_hire_date: "2020-01-01",
      pay_type: "hourly",
      current_rate: 30,
      previous_rate: 28,
      latest_wage_change_date: "2024-01-01",
      biweekly_wage: 2400,
      annual_wages: 62400,
      pto_allotment: "80",
      pto_policy_allotment: 80,
      pto_used: 8,
      pto_available: 72,
      pto_notes: "note",
      ce_budget: 500,
      ce_used: 100,
      ce_remaining: 400,
      benefits_enrolled: true,
      benefits_monthly: 200,
      benefits_annual: 2400,
      last_review_date: "2024-06-01",
      compliance: { i9: "2020-01-02" },
      separation_date: null,
      separation_type: null,
      separation_letter_signed: null,
      separation_notes: "n/a",
    },
  } as RosterRow;
}

describe("redactPrivate", () => {
  it("removes personal and HR-private fields but keeps work contact info", () => {
    const r = redactPrivate(row());
    for (const f of PRIVATE_PERSON_FIELDS) expect(r[f]).toBeNull();
    for (const f of PRIVATE_EMPLOYMENT_FIELDS) expect(r.person_employment?.[f]).toBeNull();
    expect(r.person_employment?.compliance).toEqual({});
    expect(r.email).toBe("ada@example.com");
    expect(r.phone_mobile).toBe("(555) 555-0100");
    expect(r.person_employment?.adp_job_title).toBe("RVT");
    expect(r.person_employment?.hire_date).toBe("2020-01-01");
  });

  it("does not mutate the input", () => {
    const original = row();
    redactPrivate(original);
    expect(original.date_of_birth).toBe("1990-01-01");
    expect(original.person_employment?.pto_used).toBe(8);
  });
});

describe("redactCompensation", () => {
  it("nulls every compensation field", () => {
    const r = redactCompensation(row());
    for (const f of COMPENSATION_FIELDS) expect(r.person_employment?.[f]).toBeNull();
    expect(r.person_employment?.hire_date).toBe("2020-01-01");
  });
});

// Migration 0227 revokes exactly these columns from the API role (0244 adds
// adp_employee_id without a grant).
describe("compensation column list (mirrored in migrations 0227, 0244)", () => {
  it("matches the revoked set", () => {
    expect([...COMPENSATION_FIELDS].sort()).toEqual(
      [
        "adp_employee_id",
        "pay_type",
        "current_rate",
        "previous_rate",
        "latest_wage_change_date",
        "biweekly_wage",
        "annual_wages",
        "benefits_enrolled",
        "benefits_monthly",
        "benefits_annual",
        "ce_budget",
        "ce_used",
        "ce_remaining",
        "last_review_date",
      ].sort(),
    );
  });
});

describe("roster statuses", () => {
  it("excludes applicants, which are managed only in the ATS", () => {
    expect(isRosterStatus("applicant")).toBe(false);
    expect(Object.keys(ROSTER_STATUS_LABELS)).not.toContain("applicant");
  });

  it("keeps every other employment status on the roster", () => {
    for (const s of ["prospect", "employee", "former", "contractor"] as const) {
      expect(isRosterStatus(s)).toBe(true);
      expect(ROSTER_STATUS_LABELS[s]).toBe(STATUS_LABELS[s]);
    }
    expect(Object.keys(ROSTER_STATUS_LABELS).sort()).toEqual(
      Object.keys(STATUS_LABELS).filter((s) => s !== "applicant").sort(),
    );
  });
});
