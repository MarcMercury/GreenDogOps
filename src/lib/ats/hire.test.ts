import { describe, expect, it } from "vitest";
import { employmentSeedOnHire, matchClinicLocation, type ClinicLocation } from "./hire";

const LOCATIONS: ClinicLocation[] = [
  { id: "loc-venice", name: "Venice", display_name: "Venice" },
  { id: "loc-vn", name: "Van Nuys", display_name: "The Valley" },
];

const base = {
  personId: "p1",
  today: "2026-10-13",
  existing: null,
  locations: LOCATIONS,
};

describe("matchClinicLocation", () => {
  it("matches on name or display name, case-insensitively", () => {
    expect(matchClinicLocation("van nuys", LOCATIONS)).toBe("loc-vn");
    expect(matchClinicLocation("The  Valley", LOCATIONS)).toBe("loc-vn");
    expect(matchClinicLocation("Remote", LOCATIONS)).toBeNull();
    expect(matchClinicLocation(null, LOCATIONS)).toBeNull();
  });
});

describe("employmentSeedOnHire", () => {
  it("fills hire date, job, title and clinic from the linked job", () => {
    expect(
      employmentSeedOnHire({
        ...base,
        recruiting: { pipeline: "All In House Positions", target_position_id: "job1", target_title: "csr", job_location: "Venice" },
        job: { title: "Client Service Representative", location: "Van Nuys" },
      }),
    ).toEqual({
      person_id: "p1",
      hire_date: "2026-10-13",
      position_id: "job1",
      offer_title: "Client Service Representative",
      location_id: "loc-vn",
      preferred_location_id: "loc-vn",
    });
  });

  it("falls back to the applied-for title and clinic without a linked job", () => {
    const seed = employmentSeedOnHire({
      ...base,
      recruiting: { pipeline: null, target_position_id: null, target_title: "Veterinary Assistant", job_location: "Venice" },
      job: null,
    });
    expect(seed.offer_title).toBe("Veterinary Assistant");
    expect(seed.location_id).toBe("loc-venice");
  });

  it("never uses a promoted student's program name as their job title", () => {
    const seed = employmentSeedOnHire({
      ...base,
      recruiting: { pipeline: "Students", target_position_id: null, target_title: "Externship", job_location: null },
      job: null,
    });
    expect(seed.offer_title).toBeNull();
  });

  it("never overwrites what HR already entered", () => {
    const seed = employmentSeedOnHire({
      ...base,
      existing: {
        hire_date: "2026-01-01",
        position_id: "jobX",
        offer_title: "Lead CSR",
        location_id: "loc-venice",
        preferred_location_id: "loc-venice",
      },
      recruiting: { pipeline: null, target_position_id: "job1", target_title: "CSR", job_location: "Van Nuys" },
      job: { title: "CSR", location: "Van Nuys" },
    });
    expect(seed).toMatchObject({
      hire_date: "2026-01-01",
      position_id: "jobX",
      offer_title: "Lead CSR",
      location_id: "loc-venice",
      preferred_location_id: "loc-venice",
    });
  });
});
