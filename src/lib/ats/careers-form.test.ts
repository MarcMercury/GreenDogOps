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
      resume: { fileName: "Jane Doe Resume .pdf", url: TRACK },
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
      resume: { fileName: "resume.new (1).pdf", url: TRACK },
    });
  });

  it("returns null when there is no identity", () => {
    expect(parseCareersForm("*Cover Letter*\nhello")).toBeNull();
    expect(isCareersFormBody("Hello there")).toBe(false);
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
