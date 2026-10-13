import { describe, expect, it } from "vitest";
import {
  isPromotedStudent,
  studentEducation,
  studentProgramSummary,
  studentToApplicant,
  type PromotableStudent,
} from "./promotion";

function student(over: Partial<PromotableStudent> = {}): PromotableStudent {
  return {
    id: "c1",
    first_name: "Ana",
    last_name: "Ruiz",
    full_name: null,
    email: "ana@example.com",
    phone: "3105551234",
    organization: null,
    program_type: null,
    program_name: null,
    program_subcategory: null,
    cohort: null,
    school: null,
    location: null,
    mentor: null,
    coordinator: null,
    start_date: null,
    end_date: null,
    hours_completed: null,
    hours_required: null,
    eligible_for_employment: null,
    opportunity_type: null,
    lead_source: null,
    supervising_dvm: null,
    weekday_schedule: null,
    doc_recommendation: null,
    degree_type: null,
    hire_interest: null,
    grad_year: null,
    stipend: null,
    notes: null,
    ...over,
  };
}

describe("studentToApplicant", () => {
  it("creates an applicant linked back to the student with contact details", () => {
    const { person } = studentToApplicant(
      student({ notes: "Great with cats", opportunity_type: "gdu" }),
      "2026-10-13",
    );
    expect(person).toMatchObject({
      status: "applicant",
      first_name: "Ana",
      last_name: "Ruiz",
      full_name: "Ana Ruiz",
      email: "ana@example.com",
      notes: "Great with cats",
      opportunity_type: "gdu",
      source_contact_id: "c1",
    });
    expect(person.phone_mobile).toBeTruthy();
  });

  it("prefers the stored full name", () => {
    expect(studentToApplicant(student({ full_name: "Ana M. Ruiz" }), "2026-10-13").person.full_name).toBe(
      "Ana M. Ruiz",
    );
  });

  it("seeds the recruiting record in the Students pipeline", () => {
    const { recruiting } = studentToApplicant(
      student({ program_name: "Externship", school: "UC Davis", degree_type: "DVM", grad_year: "2027" }),
      "2026-10-13",
    );
    expect(recruiting).toMatchObject({
      pipeline: "Students",
      stage: "New Lead",
      source: "Student CRM",
      target_title: "Externship",
      application_date: "2026-10-13",
      education: "DVM — UC Davis (2027)",
    });
  });

  it("keeps the student's lead source", () => {
    expect(studentToApplicant(student({ lead_source: "Career fair" }), "2026-10-13").recruiting.source).toBe(
      "Career fair",
    );
  });
});

describe("studentProgramSummary", () => {
  it("carries every program detail the ATS has no column for", () => {
    const s = studentProgramSummary(
      student({
        school: "UC Davis",
        program_type: "GDU",
        program_name: "Externship",
        program_subcategory: "Surgery",
        organization: "VetCorps",
        cohort: "Fall",
        location: "Venice",
        start_date: "2026-01-05",
        end_date: "2026-03-01",
        supervising_dvm: "Dr. Lee",
        mentor: "Sam",
        coordinator: "Jo",
        weekday_schedule: "Mon/Wed",
        doc_recommendation: "Strong",
        hire_interest: "Yes",
        stipend: "$500",
        hours_completed: 40,
        hours_required: 80,
        eligible_for_employment: true,
      }),
    );
    for (const part of [
      "School: UC Davis",
      "Program type: GDU",
      "Program: Externship / Surgery",
      "Organization: VetCorps",
      "Cohort: Fall",
      "Clinic: Venice",
      "Dates: 2026-01-05 – 2026-03-01",
      "DVM: Dr. Lee",
      "Mentor: Sam",
      "Coordinator: Jo",
      "Schedule: Mon/Wed",
      "Doc rec: Strong",
      "Hire interest: Yes",
      "Stipend: $500",
      "Hours: 40/80",
      "Eligible for employment",
    ]) {
      expect(s).toContain(part);
    }
    expect(s.startsWith("From Student CRM — ")).toBe(true);
  });

  it("falls back to a plain marker when there is nothing to carry", () => {
    expect(studentProgramSummary(student())).toBe("Promoted from Student CRM");
  });
});

describe("studentEducation", () => {
  it("handles partial data", () => {
    expect(studentEducation({ degree_type: null, school: "UC Davis", grad_year: null })).toBe("UC Davis");
    expect(studentEducation({ degree_type: null, school: null, grad_year: "2027" })).toBe("Class of 2027");
    expect(studentEducation({ degree_type: null, school: " ", grad_year: null })).toBeNull();
  });
});

describe("isPromotedStudent", () => {
  it("is true only once the student is linked to a person", () => {
    expect(isPromotedStudent({ promoted_person_id: "p1" })).toBe(true);
    expect(isPromotedStudent({ promoted_person_id: null })).toBe(false);
  });
});
