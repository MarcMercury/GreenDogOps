import { APPT_REPORT_TRACKS } from "@/lib/schedule/types";
import {
  checkbox,
  optionalEnum,
  optionalUuid,
  requiredText,
  z,
} from "@/lib/validation/form";

/** Assign an ezyVet appointment type to a department (or ignore it). */
export const apptTypeDeptSchema = z.object({
  appt_type: requiredText(200, "Appointment type"),
  department_id: optionalUuid,
  is_ignored: checkbox,
});
export type ApptTypeDeptInput = z.infer<typeof apptTypeDeptSchema>;

/** What the Department select sends: blank department = unassigned. */
export interface ApptTypeDeptValues {
  appt_type: string;
  department_id: string;
  is_ignored: boolean;
}

/** Which lane an appointment type is counted in on the Slack report; blank clears it. */
export const apptTypeReportTrackSchema = z.object({
  appt_type: requiredText(200, "Appointment type"),
  report_track: optionalEnum(APPT_REPORT_TRACKS),
});
export type ApptTypeReportTrackInput = z.infer<typeof apptTypeReportTrackSchema>;

/** What the Slack-lane select sends: blank lane = not reported. */
export interface ApptTypeReportTrackValues {
  appt_type: string;
  report_track: string;
}
