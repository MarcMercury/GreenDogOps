/** Result of a payroll Server Action: one line to show, or one reason it did not happen. */
export type PayrollResult = { ok: true; message: string } | { ok: false; error: string };
