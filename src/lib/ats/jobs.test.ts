import { describe, expect, it } from "vitest";
import { candidateJobLabel, hiresSinceOpened, jobRecruitingFields, matchOpenJob } from "./jobs";

const job = (id: string, title: string, location: string | null, status: "open" | "closed" = "open") => ({
  id,
  title,
  location,
  status,
});

const JOBS = [
  job("csr-vn", "CSR", "Van Nuys"),
  job("csr-ve", "CSR", "Venice"),
  job("dvm-vn", "DVM", "Van Nuys"),
  job("ct-ve", "Clinic Tech", "Venice"),
  job("tech-old", "Vet Tech", "Venice", "closed"),
  job("remote", "Remote CSR", null),
];

describe("matchOpenJob", () => {
  it("links on role + clinic", () => {
    expect(matchOpenJob(JOBS, "CSR", "Van Nuys")?.id).toBe("csr-vn");
    expect(matchOpenJob(JOBS, "csr", "venice")?.id).toBe("csr-ve");
  });

  it("normalizes job-board titles before comparing", () => {
    expect(matchOpenJob(JOBS, "Veterinary Receptionist", "Van Nuys")?.id).toBe("csr-vn");
    expect(matchOpenJob(JOBS, "Associate Veterinarian", "Van Nuys")?.id).toBe("dvm-vn");
  });

  it("matches on title alone when the application has no clinic and only one job fits", () => {
    expect(matchOpenJob(JOBS, "Clinic Tech", null)?.id).toBe("ct-ve");
  });

  it("leaves ambiguous applications unassigned", () => {
    expect(matchOpenJob(JOBS, "CSR", null)).toBeNull();
  });

  it("ignores closed jobs and unknown roles", () => {
    expect(matchOpenJob(JOBS, "Vet Tech", "Venice")).toBeNull();
    expect(matchOpenJob(JOBS, "Groomer", "Venice")).toBeNull();
    expect(matchOpenJob(JOBS, null, "Venice")).toBeNull();
  });

  it("does not cross clinics", () => {
    expect(matchOpenJob(JOBS, "DVM", "Venice")).toBeNull();
  });

  it("lets a job with no clinic match any clinic", () => {
    expect(matchOpenJob(JOBS, "Remote Vet Receptionist", "Remote")?.id).toBe("remote");
  });
});

describe("jobRecruitingFields", () => {
  it("syncs the title and clinic from the job", () => {
    expect(jobRecruitingFields({ id: "j", title: "CSR", location: "Venice" })).toEqual({
      target_position_id: "j",
      target_title: "CSR",
      job_location: "Venice",
    });
  });

  it("keeps the applied-to clinic when the job has none", () => {
    expect(jobRecruitingFields({ id: "j", title: "Remote CSR", location: null })).toEqual({
      target_position_id: "j",
      target_title: "Remote CSR",
    });
  });

  it("only clears the link when unassigning", () => {
    expect(jobRecruitingFields(null)).toEqual({ target_position_id: null });
  });
});

describe("candidateJobLabel", () => {
  const byId = new Map([["csr-vn", { title: "CSR", location: "Van Nuys" }]]);

  it("prefers the linked job", () => {
    expect(
      candidateJobLabel(
        { target_position_id: "csr-vn", target_title: "Old", job_location: null },
        byId,
      ),
    ).toBe("CSR — Van Nuys");
  });

  it("falls back to the free-text title and clinic", () => {
    expect(
      candidateJobLabel({ target_position_id: null, target_title: "Groomer", job_location: "Venice" }),
    ).toBe("Groomer — Venice");
    expect(candidateJobLabel({ target_position_id: null, target_title: null, job_location: null })).toBeNull();
  });
});

describe("hiresSinceOpened", () => {
  it("counts hires for this job since it was last opened", () => {
    const hires = [
      { position_id: "j", person_id: "a", name: "A", hire_date: "2026-09-01" },
      { position_id: "j", person_id: "b", name: "B", hire_date: "2026-10-07" },
      { position_id: "j", person_id: "c", name: "C", hire_date: null },
      { position_id: "other", person_id: "d", name: "D", hire_date: "2026-10-07" },
    ];
    expect(
      hiresSinceOpened(hires, { id: "j", opened_at: "2026-10-06T17:00:00Z" }).map((h) => h.person_id),
    ).toEqual(["b", "c"]);
  });
});
