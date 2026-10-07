import { describe, expect, it } from "vitest";
import {
  APP_EDIT_MARKER,
  appInputName,
  appLanguageInputName,
  appListInputName,
  appOtherInputName,
  appSkillInputName,
  applicationFromFormData,
  applicationFromLabels,
  applicationScalars,
  coerceAnswer,
  isFullApplication,
  roleGroupsFor,
  type AppField,
} from "./application";

const fields = (pairs: Array<[string, string]>) => new Map(pairs);

describe("applicationFromLabels", () => {
  it("matches labels ignoring case, punctuation, hints and aliases", () => {
    const { application, consumed } = applicationFromLabels(
      fields([
        ["are you 18 or older?", "y"],
        ["internet speed", "250"],
        ["work authorization", "TRUE"],
        ["utm_source", "indeed"],
      ]),
    );
    expect(application.answers).toEqual({
      age_18: "Yes",
      internet_mbps: "250",
      work_authorized: "Yes",
      utm_source: "indeed",
    });
    expect(consumed.size).toBe(4);
  });

  it("reads numbered employment and reference entries", () => {
    const { application } = applicationFromLabels(
      fields([
        ["employer 1", "VCA"],
        ["may we contact 1", "no"],
        ["employer 2", "Banfield"],
        ["reference 1 name", "Dr. Kim"],
        ["reference 1 relationship", "Supervisor"],
      ]),
    );
    expect(application.employment).toEqual([
      { employer: "VCA", may_contact: "No" },
      { employer: "Banfield" },
    ]);
    expect(application.references).toEqual([{ name: "Dr. Kim", relationship: "Supervisor" }]);
  });

  it("leaves an empty application when nothing matches", () => {
    expect(applicationFromLabels(fields([["favorite color", "green"]])).application).toEqual({});
  });
});

describe("coerceAnswer", () => {
  const multi: AppField = {
    key: "shifts",
    label: "Shifts",
    type: "multi",
    options: ["Mornings", "Evenings"],
  };
  it("splits multi answers and snaps them to options", () => {
    expect(coerceAnswer(multi, "- Morning\n• evenings; Overnights")).toEqual([
      "Mornings",
      "Evenings",
      "Overnights",
    ]);
  });
  it("treats an unchecked acknowledgement as no answer", () => {
    const ack: AppField = { key: "certify", label: "Certify", type: "ack" };
    expect(coerceAnswer(ack, "No")).toBeNull();
    expect(coerceAnswer(ack, "I certify the information is true")).toBe("Yes");
  });
});

describe("isFullApplication", () => {
  it("ignores a submission that only carries the basic careers-form location", () => {
    expect(isFullApplication({ answers: { locations: ["Van Nuys"] } })).toBe(false);
    expect(isFullApplication({ answers: { locations: ["Van Nuys"], text_ok: "Yes" } })).toBe(true);
    expect(isFullApplication({ employment: [{ employer: "VCA" }] })).toBe(true);
  });
});

describe("applicationScalars", () => {
  it("takes the source from the per-ad tracking field", () => {
    const s = applicationScalars({
      answers: {
        source: "indeed",
        heard_about: "Facebook",
        job_id: "CSR-12",
        highest_education: "Bachelor's",
        school: "CSUN",
        grad_year: "2019",
        current_title: "Vet Assistant",
        current_employer: "VCA",
        years_vet: "3–5",
      },
    });
    expect(s).toEqual({
      source: "Indeed",
      sourceDetail: "Website application · Job CSR-12",
      education: "Bachelor's — CSUN (2019)",
      relevantExperience: "Vet Assistant at VCA · 3–5 yrs veterinary",
    });
  });

  it("falls back to how they heard, then GD Website", () => {
    expect(applicationScalars({ answers: { heard_about: "LinkedIn" } }).source).toBe("LinkedIn");
    expect(applicationScalars({ answers: { source: "craigslist" } }).source).toBe("GD Website");
    expect(applicationScalars({}).source).toBe("GD Website");
  });
});

describe("roleGroupsFor", () => {
  it("groups canonical titles into role families", () => {
    expect([...roleGroupsFor("DVM")]).toEqual(["dvm"]);
    expect([...roleGroupsFor("Exotics RVT")].sort()).toEqual(["clinical", "rvt"]);
    expect([...roleGroupsFor("Remote CSR")].sort()).toEqual(["csr", "remote"]);
    expect([...roleGroupsFor("Mobile Vet Tech / Driver")].sort()).toEqual(["clinical", "mobile"]);
    expect([...roleGroupsFor("Recruiting Assistant")]).toEqual([]);
    expect([...roleGroupsFor("Intern")]).toEqual(["intern"]);
  });
});

describe("applicationFromFormData", () => {
  it("rebuilds the application from the profile editor and keeps extras", () => {
    const fd = new FormData();
    fd.set(APP_EDIT_MARKER, "1");
    fd.append(appInputName("shifts"), "Mornings");
    fd.append(appInputName("shifts"), "Weekends");
    fd.set(appOtherInputName("shifts"), "Overnights");
    fd.set(appInputName("text_ok"), "Yes");
    fd.set(appInputName("certify"), "on");
    fd.set(appInputName("desired_pay"), "  ");
    fd.set(appListInputName("employment", 0, "employer"), "VCA");
    fd.set(appListInputName("employment", 1, "employer"), "");
    fd.set(appLanguageInputName(0, "language"), "Spanish");
    fd.set(appLanguageInputName(0, "fluency"), "Fluent");
    fd.set(appLanguageInputName(1, "language"), "");
    fd.set(appSkillInputName("venipuncture"), "Learning");

    const out = applicationFromFormData(fd, {
      answers: { desired_pay: "$20" },
      extra: [{ label: "Favorite Animal", value: "Otters" }],
      received_at: "2026-10-01T00:00:00Z",
    });
    expect(out).toEqual({
      answers: {
        shifts: ["Mornings", "Weekends", "Overnights"],
        text_ok: "Yes",
        certify: "Yes",
      },
      employment: [{ employer: "VCA" }],
      references: [],
      languages: [{ language: "Spanish", fluency: "Fluent" }],
      skills: { venipuncture: "Learning" },
      extra: [{ label: "Favorite Animal", value: "Otters" }],
      received_at: "2026-10-01T00:00:00Z",
    });
  });
});
