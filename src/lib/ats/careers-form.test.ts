import { describe, expect, it } from "vitest";
import { isAllowedResumeHost, isCareersFormBody, parseCareersForm } from "./careers-form";

const TRACK = "http://url2611.gv-clients.com/ls/click?upn=u001.abc123";

// "Webform submission from: Apply for a position" (current format).
const WEBFORM = [
  "Submitted on Mon, 10/05/2026 - 14:07",
  "",
  "Submitted by: Anonymous",
  "",
  "Submitted values are:",
  "",
  "*Name*",
  "Jane Q Doe",
  "*Email*",
  "jane@example.com [1]",
  "*Role Applying For*",
  "Receptionist",
  "*Phone Number:*",
  "(555) 555-1234",
  "*Practice/Location*",
  "State-of-the-Art Veterinary Hospital in Van Nuys [2]",
  "*Cover Letter*",
  "Dear Hiring Manager,",
  "I love dogs.",
  "*Upload a File (please no spaces in file name, use _ / -)*",
  "Jane Doe Resume .pdf [3]",
  "     (83.68 KB)",
  "",
  "[1] mailto:jane@example.com",
  "[2] http://url2611.gv-clients.com/ls/click?upn=location",
  `[3] ${TRACK}`,
  "",
  "This email is coming from a form submitted on a site developed by GeniusVets.",
].join("\r\n");

// "Career Application NNNN" (older format).
const CAREER_APPLICATION = [
  "Submitted values are:",
  "",
  "*First Name*",
  "KATIE",
  "*Last Name*",
  "SMITH",
  "*Email*",
  "katie@example.com [1]",
  "*Role Applying For*",
  "Senior Veterinary Technician",
  "*Phone Number*",
  "5555551234 [2]",
  "*Cover Letter*",
  "RVT of 30 years.",
  "*Upload a File (please no spaces in file name, use _ / -)*",
  "resume.new (1).pdf [3]",
  "     (1.5 MB)",
  "",
  "[1] mailto:katie@example.com",
  "[2] tel:5555551234",
  `[3] ${TRACK}`,
].join("\n");

describe("parseCareersForm", () => {
  it("parses the current webform format", () => {
    expect(isCareersFormBody(WEBFORM)).toBe(true);
    expect(parseCareersForm(WEBFORM)).toEqual({
      firstName: null,
      lastName: null,
      fullName: "Jane Q Doe",
      email: "jane@example.com",
      phone: "(555) 555-1234",
      role: "Receptionist",
      location: "State-of-the-Art Veterinary Hospital in Van Nuys",
      coverLetter: "Dear Hiring Manager,\nI love dogs.",
      pastedResume: null,
      city: null,
      state: null,
      zip: null,
      uploads: [{ fileName: "Jane Doe Resume .pdf", url: TRACK, category: "resume" }],
      application: { answers: { locations: ["Van Nuys"] } },
    });
  });

  it("parses the older Career Application format", () => {
    const f = parseCareersForm(CAREER_APPLICATION);
    expect(f).toMatchObject({
      firstName: "KATIE",
      lastName: "SMITH",
      fullName: null,
      email: "katie@example.com",
      phone: "5555551234",
      role: "Senior Veterinary Technician",
      location: null,
      coverLetter: "RVT of 30 years.",
      uploads: [{ fileName: "resume.new (1).pdf", url: TRACK, category: "resume" }],
    });
  });

  it("collects every uploaded file, including a cover letter upload", () => {
    const body = [
      "*Name*",
      "Sam Lee",
      "*Email*",
      "sam@example.com [1]",
      "*Upload Resume*",
      "Sam_Lee.pdf [2]",
      "     (90 KB)",
      "*Cover Letter*",
      "Sam_Lee_CL.docx [3]",
      "     (20 KB)",
      "",
      "[1] mailto:sam@example.com",
      `[2] ${TRACK}&f=1`,
      `[3] ${TRACK}&f=2`,
    ].join("\n");
    const f = parseCareersForm(body);
    expect(f?.coverLetter).toBeNull();
    expect(f?.uploads).toEqual([
      { fileName: "Sam_Lee.pdf", url: `${TRACK}&f=1`, category: "resume" },
      { fileName: "Sam_Lee_CL.docx", url: `${TRACK}&f=2`, category: "cover_letter" },
    ]);
  });

  it("does not treat a linked email address as an upload", () => {
    expect(parseCareersForm(WEBFORM)?.uploads).toHaveLength(1);
  });

  it("returns null when there is no identity", () => {
    expect(parseCareersForm("*Cover Letter*\nhello")).toBeNull();
    expect(isCareersFormBody("Hello there")).toBe(false);
  });
});

describe("parseCareersForm — full application form", () => {
  const FULL = [
    "*First Name*",
    "Maria",
    "*Last Name*",
    "Lopez",
    "*Email*",
    "maria@example.com [1]",
    "*Phone Number*",
    "(818) 555-0101",
    "*Role Applying For*",
    "Vet Tech",
    "*Practice/Location*",
    "Sherman Oaks, Venice",
    "*City*",
    "Reseda",
    "*State*",
    "CA",
    "*ZIP Code*",
    "91335",
    "*Employment Type Desired*",
    "Full-Time",
    "Per Diem",
    "*Earliest Start Date*",
    "11/02/2026",
    "*Days Available*",
    "Monday, Tuesday, Saturday",
    "*Are you legally authorized to work in the U.S.?*",
    "Yes",
    "*Will you now or in the future require visa sponsorship?*",
    "No",
    "*Years of Veterinary Experience*",
    "3-5",
    "*Employer 1*",
    "VCA",
    "*Job Title 1*",
    "Vet Assistant",
    "*Venipuncture*",
    "Competent",
    "*Languages Spoken*",
    "English, Spanish",
    "*Spanish Fluency*",
    "Fluent",
    "*Why Green Dog, and why this role?*",
    "I love dentistry.",
    "*Favorite Animal*",
    "Otters",
    "*Paste Resume*",
    "Experienced tech.",
    "*Upload Resume*",
    "Maria_Lopez.pdf [2]",
    "",
    "[1] mailto:maria@example.com",
    `[2] ${TRACK}`,
  ].join("\n");

  it("maps every form section onto the application", () => {
    const f = parseCareersForm(FULL)!;
    expect(f).toMatchObject({
      firstName: "Maria",
      role: "Vet Tech",
      city: "Reseda",
      state: "CA",
      zip: "91335",
      pastedResume: "Experienced tech.",
      uploads: [{ fileName: "Maria_Lopez.pdf", url: TRACK, category: "resume" }],
    });
    expect(f.application.answers).toEqual({
      locations: ["Sherman Oaks", "Venice"],
      employment_types: ["Full-Time", "Per Diem"],
      start_date: "2026-11-02",
      days_available: ["Mon", "Tue", "Sat"],
      work_authorized: "Yes",
      needs_sponsorship: "No",
      years_vet: "3–5",
      why_green_dog: "I love dentistry.",
    });
    expect(f.application.employment).toEqual([{ employer: "VCA", title: "Vet Assistant" }]);
    expect(f.application.skills).toEqual({ venipuncture: "Competent" });
    expect(f.application.languages).toEqual([
      { language: "English", fluency: null },
      { language: "Spanish", fluency: "Fluent" },
    ]);
  });

  it("keeps unrecognized questions as extra answers, not identity fields", () => {
    expect(parseCareersForm(FULL)!.application.extra).toEqual([
      { label: "Favorite Animal", value: "Otters" },
    ]);
  });
});

describe("isAllowedResumeHost", () => {
  it("allows only the form-tracking and website hosts", () => {
    expect(isAllowedResumeHost(TRACK)).toBe(true);
    expect(
      isAllowedResumeHost("https://www.greendogdental.com/system/files/webform/x/40/resume.pdf"),
    ).toBe(true);
    expect(isAllowedResumeHost("https://evil.example.com/resume.pdf")).toBe(false);
    expect(isAllowedResumeHost("https://greendogdental.com.evil.io/r.pdf")).toBe(false);
    expect(isAllowedResumeHost("file:///etc/passwd")).toBe(false);
    expect(isAllowedResumeHost("not a url")).toBe(false);
  });
});
