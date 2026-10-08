import { describe, expect, it } from "vitest";
import {
  normalizeJobLocation,
  normalizePipeline,
  normalizePositionTitle,
  normalizeSource,
  normalizeStage,
} from "./normalize";
import { bucketForStage } from "./types";

describe("normalizePositionTitle", () => {
  it.each([
    ["Veterinary Receptionist", "CSR"],
    ["In-House CSR", "CSR"],
    ["CSR - SO", "CSR"],
    ["Client Service Representative", "CSR"],
    ["Remote Veterinary Receptionist Csr", "Remote CSR"],
    ["REMOTE VETERINARY RECEPTIONIST", "Remote CSR"],
    ["Remote CSR - Client Service Representative", "Remote CSR"],
    ["Remote", "Remote CSR"],
    ["Veterinary Technician", "Vet Tech"],
    ["VET TECH & Prevet student", "Vet Tech"],
    ["Senior Veterinary Technician", "Senior Vet Tech"],
    ["CT", "Clinic Tech"],
    ["RTV", "RVT"],
    ["Non-Anesthetic Pet Dental Technician - Sherman Oaks", "Dental Tech"],
    ["NAD Tech", "Dental Tech"],
    ["MPMV", "Mobile Vet Tech / Driver"],
    ["Driver/Asst", "Mobile Vet Tech / Driver"],
    ["Asistente de Limpieza, Clínica Veterinaria", "Facilities / Cleaning"],
    ["Fac - Venice", "Facilities / Cleaning"],
    ["Janitor", "Facilities / Cleaning"],
    ["DVM Extern", "Extern"],
    ["Western University Rotating Internship -2026", "Intern"],
    ["Veterinarian", "DVM"],
    ["Veterinary Technician / Practice Manager", "Practice Manager"],
    ["Recruiting Asst", "Recruiting Assistant"],
    ["Admin", "Executive Assistant"],
    ["Marketing & Events Coordinator - Venice & Sherman Oaks", "Marketing"],
    ["VETERINARY/ ANIMAL CARE SPECIALIST /COORDINATOR", "Vet Assistant"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizePositionTitle(raw)).toBe(expected);
  });

  it("passes unknown or ambiguous titles through, trimmed", () => {
    expect(normalizePositionTitle("  DH ")).toBe("DH");
    expect(normalizePositionTitle("Remote Bookkeeper")).toBe("Remote Bookkeeper");
    expect(normalizePositionTitle("Marketing Manager")).toBe("Marketing");
    expect(normalizePositionTitle("")).toBeNull();
    expect(normalizePositionTitle(null)).toBeNull();
  });

  it("is idempotent on canonical values", () => {
    for (const v of ["CSR", "Remote CSR", "Vet Tech", "Senior Vet Tech", "RVT", "Exotics RVT",
      "Clinic Tech", "Dental Tech", "Mobile Vet Tech / Driver", "Facilities / Cleaning",
      "Practice Manager", "Executive Assistant", "Recruiting Assistant", "Marketing",
      "Vet Assistant", "Kennel Technician", "DVM", "Extern", "Intern", "Volunteer"]) {
      expect(normalizePositionTitle(v)).toBe(v);
    }
  });
});

describe("normalizeStage", () => {
  it.each([
    ["Applicant", "New Lead"],
    ["Reviewed", "New Lead"],
    ["Contacting", "Contacted"],
    ["Hire", "Hired"],
    ["Hold For Future", "Hold for Future"],
    ["Did not respond", "No Response"],
    ["No hire", "Passed"],
    ["Not moving forward", "Passed"],
    ["Declined Offer", "Offer Declined"],
    ["QUIT", "Separated"],
    ["Seperated ( No Rehire )", "Separated (No Rehire)"],
    ["Shadow Interview", "Shadow Day"],
    ["In-Person / Shadow Day", "Shadow Day"],
    ["Interviewed", "Interview"],
    ["Zoom/Virtual Interview", "Interview"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeStage(raw)).toBe(expected);
  });

  it("keeps the canonical stage buckets intact", () => {
    expect(bucketForStage(normalizeStage("Offer Declined"))).toBe("passed");
    expect(bucketForStage(normalizeStage("Separated (No Rehire)"))).toBe("passed");
    expect(bucketForStage(normalizeStage("Applicant"))).toBe("active");
    expect(bucketForStage("DO NOT CONTACT AGAIN")).toBe("passed");
  });
});

describe("normalizeSource", () => {
  it.each([
    ["BONUS in Jan 24'", "Personal Referral"],
    ["Doc", "Personal Referral"],
    ["Nick social media", "Social Media"],
    ["Nick college post", "College / School"],
    ["Linkedin (Nick)", "LinkedIn"],
    ["walk", "Walk-in"],
    ["Laurence - Visited Clinic", "Walk-in"],
    ["ZipR", "ZipRecruiter"],
    ["OLD MVS grid", "OLD MVS grid"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeSource(raw)).toBe(expected);
  });

  it("drops junk values", () => {
    expect(normalizeSource("Yes")).toBeNull();
  });
});

describe("normalizeJobLocation / normalizePipeline", () => {
  it("collapses applied-to locations to clinic names", () => {
    expect(normalizeJobLocation("Van Nuys, CA 91401")).toBe("Van Nuys");
    expect(normalizeJobLocation("Van Nuys, CA 91411")).toBe("Van Nuys");
    expect(normalizeJobLocation("Venice, CA 90294")).toBe("Venice");
    expect(normalizeJobLocation("Sherman Oaks, CA 91423")).toBe("Sherman Oaks");
    expect(normalizeJobLocation("Remote")).toBe("Remote");
  });

  it("collapses multi-value pipelines", () => {
    expect(normalizePipeline("All In House Positions, Remote CSR")).toBe("All In House Positions");
    expect(normalizePipeline("Remote CSR, Hired")).toBe("Hired");
    expect(normalizePipeline("MVS New Hires")).toBe("MVS New Hires");
  });
});
