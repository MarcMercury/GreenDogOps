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
  | "long_timestamp"
  /** DAY-first date — Estimate Status only. */
  | "dmy_date";

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

  estimate_status: {
    key: "estimate_status",
    table: "ezyvet_estimate",
    required: ["estimate number", "status", "total value"],
    dateColumn: "date_sent",
    // Estimates move Created -> Sent -> Accepted over days, so re-read a window.
    conflict: ["estimate_number"],
    columns: [
      // Reads "Not Sent" until the estimate goes out, hence the raw copy.
      { csv: "Date Sent", column: "date_sent", type: "dmy_date" },
      txt("Date Sent", "date_sent_raw"),
      txt("Originator", "originator"),
      int("Estimate Number", "estimate_number"),
      txt("Estimate Name", "estimate_name"),
      txt("Customer Number", "customer_number"),
      txt("Customer Name", "customer_name"),
      txt("Email", "email"),
      txt("Status", "status"),
      num("Excluded From Markup Value", "excluded_from_markup_value"),
      num("Product Value", "product_value"),
      num("Total Value", "total_value"),
      { csv: "Next Action Date", column: "next_action_date", type: "dmy_date" },
      txt("Last Comment", "last_comment"),
      num("Cost Of Estimate", "cost_of_estimate"),
    ],
    identity: ["estimate_number"],
  },

  // ── Clinical / compliance ──────────────────────────────────────────────────
  consult_metrics: {
    key: "consult_metrics",
    table: "ezyvet_consult_metric",
    required: ["consult", "case owner", "presenting problems"],
    dateColumn: "created_date",
    conflict: ["consult_number"],
    columns: [
      { csv: "Created", column: "consult_created_at", type: "timestamp" },
      { csv: "Created", column: "created_date", type: "date" },
      int("Consult", "consult_number"),
      txt("Case Owner", "case_owner"),
      txt("Pet Name", "pet_name"),
      { csv: "Date of Birth", column: "date_of_birth", type: "date" },
      txt("Owner", "owner"),
      txt("Species", "species"),
      txt("Breed", "breed"),
      num("Animal Weight (lb)", "weight_lb"),
      txt("Master Problems", "master_problems"),
      txt("Presenting Problems", "presenting_problems"),
    ],
    identity: ["consult_number"],
  },

  clinical_note_approval: {
    key: "clinical_note_approval",
    table: "ezyvet_clinical_note",
    required: ["record type", "consult", "approved by"],
    locationFrom: "Department",
    dateColumn: "note_created_date",
    columns: [
      txt("Record Type", "record_type"),
      int("Consult", "consult_number"),
      txt("Case Owner", "case_owner"),
      txt("Department", "department"),
      txt("Animal Name", "animal_name"),
      txt("Animal Code", "animal_code"),
      txt("Approved By", "approved_by"),
      { csv: "Approved At", column: "approved_at", type: "timestamp" },
      txt("Created By", "note_created_by"),
      { csv: "Created At", column: "note_created_at", type: "timestamp" },
      { csv: "Created At", column: "note_created_date", type: "date" },
      txt("Modified By", "modified_by"),
      { csv: "Modified At", column: "modified_at", type: "timestamp" },
    ],
    identity: ["consult_number", "record_type"],
  },

  controlled_drug: {
    key: "controlled_drug",
    table: "ezyvet_controlled_drug",
    required: ["date / time", "product code", "dispense type"],
    // ⚠ ezyVet's export is SHIFTED: its header declares one column too many
    // ("Product Identifier"), so the clinic lands under the "Batch" header and
    // the real "Division" column is always empty. Verified across every row.
    locationFrom: "Batch",
    dateColumn: "dispensed_date",
    // The export also carries client DOB, phone and home address. None of that
    // is needed for controlled-substance reporting, so it is deliberately not
    // mapped and never lands in the database.
    columns: [
      { csv: "Date / Time", column: "dispensed_at", type: "timestamp" },
      { csv: "Date / Time", column: "dispensed_date", type: "date" },
      txt("Product Code", "product_code"),
      txt("Product Name", "product_name"),
      txt("Prescriber", "prescriber"),
      txt("Prescriber DEA Number", "prescriber_dea"),
      txt("Dispense Type", "dispense_type"),
      num("Dispensed", "dispensed_qty"),
      num("Qty On Hand", "qty_on_hand"),
      txt("Dispensing User", "dispensing_user"),
      txt("Client Code", "client_code"),
      txt("Client Name", "client_name"),
      txt("Pet Code", "pet_code"),
      txt("Pet Name", "pet_name"),
      txt("Pet Species", "pet_species"),
      txt("Prescription No.", "prescription_no"),
      txt("Medication Instructions", "medication_instructions"),
      int("Refills Left", "refills_left"),
      int("Days Supply", "days_supply"),
      txt("Invoice No.", "invoice_no"),
      txt("Invoice Status", "invoice_status"),
      txt("Product Schedule/Class", "product_schedule_class"),
      txt("Batch", "division"),
    ],
    identity: ["product_code", "dispensed_at"],
  },

  vaccinations: {
    key: "vaccinations",
    table: "ezyvet_vaccination",
    required: ["vaccination id", "vaccination date", "vaccination product"],
    dateColumn: "vaccination_date",
    conflict: ["vaccination_id"],
    columns: [
      txt("Vaccination ID", "vaccination_id"),
      txt("Vaccination Creating User", "creating_user"),
      { csv: "Vaccination Creation Time", column: "created_at_ezyvet", type: "timestamp" },
      txt("Vaccination Modifying User", "modifying_user"),
      { csv: "Vaccination Modified Time", column: "modified_at", type: "timestamp" },
      { csv: "Vaccination Active", column: "is_active", type: "bool" },
      txt("Vaccination Sales Resource", "sales_resource"),
      txt("Vaccination Approved By", "approved_by"),
      { csv: "Vaccination Approved At", column: "approved_at", type: "timestamp" },
      txt("Vaccination Consult", "consult"),
      txt("Vaccination External Reference", "external_reference"),
      txt("Vaccination Animal", "animal"),
      { csv: "Vaccination Date", column: "vaccination_date", type: "date" },
      txt("Vaccination Notes", "notes"),
      txt("Vaccination Vet User", "vet_user"),
      txt("Vaccination Product", "product"),
      num("Vaccination Quantity", "quantity"),
      txt("Vaccination Description", "description"),
      { csv: "Vaccination Next Date", column: "next_date", type: "date" },
      { csv: "Vaccination Send Reminder", column: "send_reminder", type: "bool" },
      { csv: "Vaccination Historical", column: "is_historical", type: "bool" },
      txt("Vaccination Annual Health Product", "annual_health_product"),
      txt("Vaccination Event", "event"),
    ],
    identity: ["vaccination_id"],
  },

  soc_overdue: {
    key: "soc_overdue",
    table: "ezyvet_soc_overdue",
    required: ["animal number", "soc due date", "appointment date"],
    locationFrom: "Department",
    columns: [
      txt("Animal Number", "animal_number"),
      txt("Animal Name", "animal_name"),
      txt("Species", "species"),
      txt("Breed", "breed"),
      txt("Owner First Name", "owner_first_name"),
      txt("Owner Last Name", "owner_last_name"),
      txt("Phone Numbers", "phone_numbers"),
      txt("Mobile Numbers", "mobile_numbers"),
      txt("Email Addresses", "email_addresses"),
      txt("SOC Treatment/Vaccine", "soc_treatment"),
      txt("SOC Type", "soc_type"),
      { csv: "SOC Due Date", column: "soc_due_date", type: "date" },
      int("Days Overdue", "days_overdue"),
      { csv: "Last Fulfilled Date", column: "last_fulfilled_date", type: "date" },
      { csv: "Appointment Date", column: "appt_date", type: "date" },
      int("Days Until Appointment", "days_until_appt"),
      int("Appointment Duration (minutes)", "appt_duration_minutes"),
      txt("Appointment Reason/Notes", "appt_reason"),
      txt("Appointment Status", "appt_status"),
      txt("Appointment Type", "appt_type"),
      { csv: "SOC Created Date", column: "soc_created_date", type: "date" },
      txt("Department", "department"),
    ],
    identity: ["animal_number", "soc_treatment"],
  },

  wellness_plan_use: {
    key: "wellness_plan_use",
    table: "ezyvet_wellness_plan_use",
    required: ["uniqueid", "plan", "benefit"],
    locationFrom: "Department",
    conflict: ["unique_id", "snapshot_date"],
    columns: [
      txt("UniqueId", "unique_id"),
      txt("Customer Code", "customer_code"),
      txt("Customer Name", "customer_name"),
      txt("Pet Code", "pet_code"),
      txt("Pet Name", "pet_name"),
      txt("Plan", "plan"),
      txt("Department", "department"),
      { csv: "Term Start Date", column: "term_start_date", type: "date" },
      txt("Benefit", "benefit"),
      txt("Benefit Type", "benefit_type"),
      num("Saved", "saved"),
      num("Allocated", "allocated"),
      num("Used", "used"),
      num("Available", "available"),
    ],
    identity: ["unique_id"],
  },

  // ── Inventory / supply chain ───────────────────────────────────────────────
  inventory_value: {
    key: "inventory_value",
    table: "ezyvet_inventory_value",
    required: ["code", "qty in inventory", "total inventory value"],
    conflict: ["product_code", "snapshot_date"],
    columns: [
      txt("Code", "product_code"),
      txt("Name", "product_name"),
      txt("Product Group", "product_group"),
      num("Current Unit Cost", "current_unit_cost"),
      num("Weighted Average Cost Price Per Unit", "weighted_avg_unit_cost"),
      num("Qty In Inventory", "qty_in_inventory"),
      num("Total Inventory Value", "total_inventory_value"),
    ],
    identity: ["product_code"],
  },

  expiring_inventory: {
    key: "expiring_inventory",
    table: "ezyvet_expiring_inventory",
    required: ["product code", "expiry date", "quantity in stock"],
    columns: [
      txt("Product Code", "product_code"),
      txt("Product Name", "product_name"),
      txt("Supplier Name", "supplier_name"),
      txt("Batch Number", "batch_number"),
      { csv: "Expiry Date", column: "expiry_date", type: "date" },
      num("Quantity In Stock", "qty_in_stock"),
      num("Quantity Available", "qty_available"),
      num("Total Available Cost", "total_available_cost"),
      txt("Location Name", "location_name"),
    ],
    identity: ["product_code", "batch_number"],
  },

  expired_inventory: {
    key: "expired_inventory",
    table: "ezyvet_expired_inventory",
    required: ["product code", "expiry date"],
    columns: [
      txt("Product Code", "product_code"),
      txt("Product Name", "product_name"),
      txt("Supplier", "supplier"),
      txt("Batch Number", "batch_number"),
      { csv: "Expiry Date", column: "expiry_date", type: "date" },
      num("Quantity In Stock (Total)", "qty_in_stock"),
    ],
    identity: ["product_code", "batch_number"],
  },

  inventory_ordering: {
    key: "inventory_ordering",
    table: "ezyvet_inventory_ordering",
    required: ["code", "in inventory", "to order"],
    conflict: ["product_code", "snapshot_date"],
    columns: [
      txt("Code", "product_code"),
      txt("Name", "product_name"),
      num("In Inventory", "in_inventory"),
      num("Available", "available"),
      num("Ordered", "ordered"),
      num("Receipting", "receipting"),
      num("Short", "short"),
      num("To Order", "to_order"),
      num("Inventory Turn (Last month)", "turn_last_month"),
      num("Inventory Turn Last 12Mths", "turn_last_12_months"),
      num("Average Monthly Inventory Turn", "avg_monthly_turn"),
    ],
    identity: ["product_code"],
  },

  inventory_transfer: {
    key: "inventory_transfer",
    table: "ezyvet_inventory_transfer",
    required: ["inventory transfer number", "product code", "quantity"],
    locationFrom: "Inventory Location",
    dateColumn: "transfer_date",
    columns: [
      txt("Inventory Transfer Number", "transfer_number"),
      txt("Product Code", "product_code"),
      txt("Product", "product_name"),
      txt("Product Description", "product_description"),
      { csv: "Date/Time", column: "transferred_at", type: "timestamp" },
      { csv: "Date/Time", column: "transfer_date", type: "date" },
      txt("Created", "created_by"),
      txt("Inventory Location", "inventory_location"),
      txt("Last Modified", "last_modified"),
      txt("Reason", "reason"),
      num("Quantity", "quantity"),
      txt("Batch", "batch"),
      txt("Account", "account"),
      num("In Inventory", "in_inventory"),
      num("Available", "available"),
      num("Per Unit Cost ($)", "per_unit_cost"),
      num("Total", "total"),
    ],
    identity: ["transfer_number", "product_code"],
  },

  purchases: {
    key: "purchases",
    table: "ezyvet_purchase",
    required: ["date", "product code", "invoice total (exc tax)"],
    locationFrom: "Purchase For",
    dateColumn: "purchase_date",
    columns: [
      { csv: "Date", column: "purchase_date", type: "date" },
      txt("Receive Invoice", "receive_invoice"),
      txt("Supplier Invoice Number", "supplier_invoice_number"),
      txt("Purchase For", "purchase_for"),
      txt("Purchase Orders", "purchase_orders"),
      txt("Product Code", "product_code"),
      txt("Product Name", "product_name"),
      txt("Supplier Code", "supplier_code"),
      num("Qty", "qty"),
      num("Invoice Price (exc TAX)", "unit_price_excl"),
      num("Invoice Price (inc TAX)", "unit_price_incl"),
      num("Invoice Total (exc TAX)", "total_excl"),
      num("Invoice Total (inc TAX)", "total_incl"),
    ],
    identity: ["product_code", "receive_invoice"],
  },
};
