export interface SheetSyncSource {
  id: string;
  key: string;
  name: string;
  description: string | null;
  spreadsheet_url: string | null;
  enabled: boolean;
  last_modified_time: string | null;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_summary: Record<string, unknown> | null;
}

export interface SheetSyncIssue {
  id: string;
  source_key: string;
  kind: string;
  subject: string;
  detail: Record<string, unknown> | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

export const SHEET_ISSUE_LABELS: Record<string, string> = {
  employee_missing_from_sheet: "Active in the app, on neither HR tab",
  grid_name_collision: "GRID NAME belongs to someone else",
  duplicate_person_rows: "Duplicate person rows",
  unmatched_schedule_name: "Schedule name matches nobody",
  too_many_new_people: "Refused: implausible number of new people",
  missing_column: "Sheet layout changed",
  apply_failed: "Change could not be applied",
};

/** Issues that mean the sheet itself is wrong get the loudest styling. */
export const SHEET_ISSUE_TONE: Record<string, "danger" | "warn"> = {
  grid_name_collision: "danger",
  too_many_new_people: "danger",
  missing_column: "danger",
  apply_failed: "danger",
};
