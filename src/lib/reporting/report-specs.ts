/**
 * Declarative specs for every spec-driven ezyVet report (see generic-ingest.ts).
 *
 * One entry per report. `key` matches agent/ezyvet/report-catalog.mjs, the
 * agent_report catalog row, and the /api/agents/ezyvet/report/<key> sink.
 *
 * Every table also carries snapshot_date / period_start / period_end, added by
 * the ingest — do not list them here.
 */

export type ColumnType =
  | "text"
  | "numeric"
  | "int"
  | "bool"
  | "date"
  | "timestamp"
  /** Strips a trailing colon from a metric label. */
  | "label"
  /** Leading integer of a combined cell, e.g. "957081 (09-09-2026 8:42am)". */
  | "leading_int"
  /** Timestamp inside the parentheses of the same combined cell. */
  | "paren_timestamp"
  /** Date part of that parenthesised timestamp. */
  | "paren_date"
  /** Long-form date, e.g. "26th August 2026 09:00AM". */
  | "long_date"
  | "long_timestamp";

export type ColumnSpec = {
  /** CSV header. A trailing "(" matches by prefix, e.g. "Due(" -> "Due(09-09-2026)". */
  csv: string;
  column: string;
  type: ColumnType;
};

export type ReportSpec = {
  key: string;
  table: string;
  /** Headers that must all be present to identify the real header row. */
  required: string[];
  columns: ColumnSpec[];
  /** Key/value reports have no header row (End of Day Totals). */
  layout?: "key-value";
  /** Column that receives the current section divider's label. */
  sectionColumn?: string;
  /** Removed from a section label before storing, e.g. " (12 invoices)". */
  sectionStrip?: RegExp;
  /** CSV column used to derive location_key. */
  locationFrom?: string;
  /** Derive location_key from the section divider instead of a column. */
  locationFromSection?: boolean;
  /** Date column that scopes the delete-and-reinsert window rebuild. */
  dateColumn?: string;
  /** Natural key. Present = upsert; absent = window rebuild. */
  conflict?: string[];
  /** Columns that must not ALL be null for a row to count as a record. */
  identity?: string[];
  /** Positional aging buckets, newest first (Aged Receivables month columns). */
  buckets?: { after: string; before: string; columns: string[] };
};

const num = (csv: string, column: string): ColumnSpec => ({ csv, column, type: "numeric" });
const int = (csv: string, column: string): ColumnSpec => ({ csv, column, type: "int" });
const txt = (csv: string, column: string): ColumnSpec => ({ csv, column, type: "text" });

/** The 15 appointment statuses the Appointment Status report times. */
const APPOINTMENT_STATUS_COLUMNS: ColumnSpec[] = [
  ["No Status", "mins_no_status"],
  ["Unconfirmed", "mins_unconfirmed"],
  ["Confirmed", "mins_confirmed"],
  ["In Transit", "mins_in_transit"],
  ["In Waiting Room", "mins_in_waiting_room"],
  ["In Consultation", "mins_in_consultation"],
  ["In Procedure", "mins_in_procedure"],
  ["Admit For Surgery", "mins_admit_for_surgery"],
  ["In Hospital", "mins_in_hospital"],
  ["In Discharge", "mins_in_discharge"],
  ["Awaiting Collect", "mins_awaiting_collect"],
  ["Departed", "mins_departed"],
  ["Interim Report", "mins_interim_report"],
  ["Referral Done", "mins_referral_done"],
  ["Complete", "mins_complete"],
].map(([csv, column]) => num(csv, column));

export const REPORT_SPECS: Record<string, ReportSpec> = {
  // ── Financial: cash, receivables, close ────────────────────────────────────
  payment_summary: {
    key: "payment_summary",
    table: "ezyvet_payment",
    required: ["date", "number", "division", "amount"],
    // The export is grouped: a bare payment-method line, then that method's rows.
    sectionColumn: "payment_method",
    locationFrom: "Division",
    dateColumn: "payment_date",
    columns: [
      { csv: "Date", column: "payment_date", type: "date" },
      { csv: "Date", column: "paid_at", type: "timestamp" },
      int("Number", "payment_number"),
      txt("Division", "division"),
      txt("Customer Code", "customer_code"),
      txt("Customer", "customer"),
      num("Amount", "amount"),
      num("Surcharge", "surcharge"),
      txt("Card Brand", "card_brand"),
      num("Integrated Surcharge", "integrated_surcharge"),
      txt("Created By", "created_by"),
      txt("Modified By", "modified_by"),
    ],
    identity: ["payment_number"],
  },

  payment_allocations: {
    key: "payment_allocations",
    table: "ezyvet_payment_allocation",
    required: ["date", "payment number", "invoice number", "divisional amount"],
    locationFrom: "Division",
    dateColumn: "allocation_date",
    columns: [
      { csv: "Date", column: "allocation_date", type: "date" },
      int("Payment Number", "payment_number"),
      txt("Payment Division", "payment_division"),
      txt("Client", "client"),
      int("Invoice Number", "invoice_number"),
      txt("Division", "division"),
      num("Divisional Amount", "divisional_amount"),
      num("Total For Invoice", "total_for_invoice"),
      num("Total Payment Amount", "total_payment_amount"),
    ],
    identity: ["payment_number", "invoice_number"],
  },

  aged_receivables: {
    key: "aged_receivables",
    table: "ezyvet_aged_receivable",
    required: ["contact code", "client", "total due"],
    // Buckets are named after calendar months, so resolve them by position:
    // rightmost = the current month, then 30 / 60 / 90+ days older.
    buckets: {
      after: "Email",
      before: "Total Due",
      columns: ["bucket_current", "bucket_30", "bucket_60", "bucket_90_plus"],
    },
    conflict: ["contact_code", "snapshot_date"],
    columns: [
      txt("Contact Code", "contact_code"),
      txt("Title", "title"),
      txt("Client", "client"),
      txt("First Name", "first_name"),
      txt("Contact Tag(s)", "contact_tags"),
      txt("Email", "email"),
      num("Total Due", "total_due"),
      num("Last 30 days payments total", "last_30_days_payments"),
    ],
    identity: ["contact_code"],
  },

  end_of_day_totals: {
    key: "end_of_day_totals",
    table: "ezyvet_end_of_day",
    layout: "key-value",
    required: [],
    conflict: ["metric", "snapshot_date"],
    columns: [
      { csv: "", column: "metric", type: "label" },
      num("", "amount"),
    ],
    identity: ["metric"],
  },

  invoice_credit_summary: {
    key: "invoice_credit_summary",
    table: "ezyvet_invoice_summary",
    required: ["contact code", "invoice", "status"],
    locationFrom: "Invoice Department Name",
    dateColumn: "invoice_date",
    // Invoices flip Pending -> Approved days later, so re-read a window and
    // upsert rather than freezing the first read.
    conflict: ["invoice_number"],
    columns: [
      txt("Contact Code", "contact_code"),
      { csv: "Date", column: "invoice_date", type: "date" },
      int("Invoice", "invoice_number"),
      txt("Purchase Order", "purchase_order"),
      txt("Client", "client"),
      txt("Status", "status"),
      num("Total Credits(Inc.TAX)", "total_credits_incl"),
      num("Total Debits(Inc.TAX)", "total_debits_incl"),
      num("Invoice / Credit Amount Exc. TAX", "amount_excl"),
      num("Invoice / Credits Amount Inc. TAX", "amount_incl"),
      num("Due(", "amount_due"),
      { csv: "Invoice Due Date", column: "due_at", type: "timestamp" },
      txt("Contact Department Name", "contact_department"),
      txt("Pet Code", "pet_code"),
      txt("Pet Name", "pet_name"),
      txt("Pet Insurance Supplier", "pet_insurance_supplier"),
      txt("Pet Insurance Number", "pet_insurance_number"),
      txt("Invoice Department Name", "invoice_department"),
      txt("Invoice Comments", "invoice_comments"),
      txt("Invoice Payment Terms", "payment_terms"),
    ],
    identity: ["invoice_number"],
  },

  unapplied_payments: {
    key: "unapplied_payments",
    table: "ezyvet_unapplied_payment",
    required: ["number", "date", "client code", "amount"],
    dateColumn: "payment_date",
    columns: [
      int("Number", "payment_number"),
      { csv: "Date", column: "payment_date", type: "date" },
      txt("Client Code", "client_code"),
      txt("Client Name", "client_name"),
      txt("Type", "record_type"),
      num("Amount", "amount"),
    ],
    identity: ["payment_number"],
  },

  taxable_sales: {
    key: "taxable_sales",
    table: "ezyvet_taxable_sales",
    required: ["tax code", "total invoiced (excl)"],
    // Grouped by department; the trailing "Total" block is dropped.
    sectionColumn: "department",
    locationFromSection: true,
    columns: [
      txt("Tax Code", "tax_code"),
      num("Tax %", "tax_percent"),
      num("Total Invoiced (Excl)", "total_invoiced_excl"),
      num("Total Tax Amount", "total_tax"),
      num("Total Invoiced (Incl)", "total_invoiced_incl"),
    ],
    identity: ["tax_code"],
  },

  disabled_records: {
    key: "disabled_records",
    table: "ezyvet_disabled_record",
    required: ["code", "name", "date disabled"],
    dateColumn: "disabled_date",
    columns: [
      txt("Code", "code"),
      txt("Name", "name"),
      { csv: "Date Disabled", column: "disabled_date", type: "date" },
      { csv: "Date Disabled", column: "disabled_at", type: "timestamp" },
      txt("Disabled By", "disabled_by"),
    ],
    identity: ["code", "name"],
  },

  staff_sales: {
    key: "staff_sales",
    table: "ezyvet_staff_sale",
    required: ["invoice", "t/o"],
    // Grouped per staff member: "AP Admin  (1 invoices)".
    sectionColumn: "staff_member",
    sectionStrip: /\s*\(\d+\s+invoices?\)\s*$/i,
    dateColumn: "invoice_date",
    columns: [
      { csv: "Invoice", column: "invoice_number", type: "leading_int" },
      { csv: "Invoice", column: "invoiced_at", type: "paren_timestamp" },
      { csv: "Invoice", column: "invoice_date", type: "paren_date" },
      num("T/O", "turnover"),
      num("G/P for Markup Products $", "gross_profit"),
      num("G/P for Markup Products %", "gross_profit_pct"),
    ],
    identity: ["invoice_number"],
  },

  customer_invoice_statistics: {
    key: "customer_invoice_statistics",
    table: "ezyvet_customer_invoice_stat",
    required: ["last name", "turn over($)", "no. of inv"],
    columns: [
      txt("Business Name", "business_name"),
      txt("First Name", "first_name"),
      txt("Last Name", "last_name"),
      txt("Email", "email"),
      num("Turn Over($)", "turnover"),
      num("Gross Profit($)", "gross_profit"),
      int("No. Of Inv", "invoice_count"),
      int("No. Of Inv Ln", "invoice_line_count"),
      num("Avg $T/O Per Inv", "avg_turnover_per_invoice"),
      num("Avg $T/O Per Inv Ln", "avg_turnover_per_line"),
      num("Avg $GP Per Inv", "avg_gross_profit_per_invoice"),
      num("Avg $GP Per Inv Ln", "avg_gross_profit_per_line"),
    ],
    identity: ["last_name", "business_name"],
  },

  // ── Appointments / operations ──────────────────────────────────────────────
  appointment_status: {
    key: "appointment_status",
    table: "ezyvet_appointment_status",
    required: ["division", "animal", "appointment date/time"],
    locationFrom: "Division",
    dateColumn: "appt_date",
    columns: [
      txt("Division", "division"),
      txt("Animal", "animal"),
      txt("Owner", "owner"),
      { csv: "Appointment Date/Time", column: "appt_at", type: "timestamp" },
      { csv: "Appointment Date/Time", column: "appt_date", type: "date" },
      ...APPOINTMENT_STATUS_COLUMNS,
      // Reads "Not Complete" for appointments that never finished, so keep the
      // raw label alongside the numeric minutes.
      txt("Time To Complete", "time_to_complete"),
      num("Time To Complete", "mins_to_complete"),
    ],
    identity: ["animal", "appt_at"],
  },

  appointment_type: {
    key: "appointment_type",
    table: "ezyvet_appointment_type_stat",
    required: ["division", "type", "count"],
    locationFrom: "Division",
    columns: [
      txt("Division", "division"),
      txt("Type", "appt_type"),
      int("Count", "appt_count"),
      num("Average Time(Mins)", "avg_minutes"),
      num("Total Time(Mins)", "total_minutes"),
    ],
    identity: ["appt_type"],
  },

  unbilled_consults: {
    key: "unbilled_consults",
    table: "ezyvet_unbilled_consult",
    required: ["appointment time", "consult number", "consult division"],
    locationFrom: "Consult Division",
    dateColumn: "appt_date",
    columns: [
      { csv: "Appointment Time", column: "appt_at", type: "long_timestamp" },
      { csv: "Appointment Time", column: "appt_date", type: "long_date" },
      txt("Client Contact Code", "client_contact_code"),
      txt("Business Name", "business_name"),
      txt("First Name", "first_name"),
      txt("Last Name", "last_name"),
      txt("Pet Name", "pet_name"),
      int("Consult Number", "consult_number"),
      txt("Appointment Type", "appt_type"),
      txt("Consult Division", "consult_division"),
      txt("Reason for Appointment", "reason"),
    ],
    identity: ["consult_number"],
  },
};
