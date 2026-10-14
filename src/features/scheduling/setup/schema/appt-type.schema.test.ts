import { describe, expect, it } from "vitest";
import { parseForm } from "@/lib/validation/form";
import { apptTypeDeptSchema, apptTypeReportTrackSchema } from "./appt-type.schema";

const DEPT = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("apptTypeDeptSchema", () => {
  it("reads an assignment, an ignore and an unassign the way the select sends them", () => {
    expect(parseForm(apptTypeDeptSchema, form({ appt_type: "GDD (New)", department_id: DEPT }))).toEqual({
      ok: true,
      data: { appt_type: "GDD (New)", department_id: DEPT, is_ignored: false },
    });
    expect(parseForm(apptTypeDeptSchema, form({ appt_type: "Grooming", is_ignored: "on" }))).toEqual({
      ok: true,
      data: { appt_type: "Grooming", department_id: null, is_ignored: true },
    });
    expect(parseForm(apptTypeDeptSchema, form({ appt_type: "Exam" }))).toEqual({
      ok: true,
      data: { appt_type: "Exam", department_id: null, is_ignored: false },
    });
  });

  it("requires the appointment type", () => {
    expect(parseForm(apptTypeDeptSchema, form({ appt_type: " " })).ok).toBe(false);
  });
});

describe("apptTypeReportTrackSchema", () => {
  it("accepts a known lane, clears on blank and rejects an unknown lane", () => {
    expect(parseForm(apptTypeReportTrackSchema, form({ appt_type: "NAD", report_track: "nad" }))).toEqual({
      ok: true,
      data: { appt_type: "NAD", report_track: "nad" },
    });
    expect(parseForm(apptTypeReportTrackSchema, form({ appt_type: "NAD" }))).toEqual({
      ok: true,
      data: { appt_type: "NAD", report_track: null },
    });
    expect(parseForm(apptTypeReportTrackSchema, form({ appt_type: "NAD", report_track: "xx" })).ok).toBe(false);
  });
});
