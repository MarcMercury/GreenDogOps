/** One row of `payroll_export` as the page lists it (the table is append-only). */
export interface PayrollExportRow {
  id: string;
  format: string;
  file_name: string;
  file_sha256: string;
  employee_count: number;
  created_at: string;
}
