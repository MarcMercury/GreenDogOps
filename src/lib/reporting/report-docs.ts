/**
 * Human-facing documentation for each spec-driven ezyVet report.
 *
 * Single source of truth for the generated migration's table comments, the
 * agent_report catalog rows shown in Admin ▸ Agents, and the Smart Report's
 * domain notes — so the description a person reads, the one stored in the
 * database, and the one the model is given can never disagree.
 */
export type ReportDoc = {
  /** Display name in the agent catalog. */
  title: string;
  /** Exact ezyVet Report Center name. */
  report: string;
  /** One line: what the report is for. */
  purpose: string;
  /** Longer note stored as the table comment and fed to the Smart Report. */
  comment: string;
};

export const REPORT_DOCS: Record<string, ReportDoc> = {
  payment_summary: {
    title: "Payments",
    report: "Payment Summary",
    purpose: "Every payment taken, by method and hospital — what was actually COLLECTED.",
    comment:
      "One row per payment received, from the ezyVet Payment Summary report. " +
      "payment_method is the section the payment was listed under (Visa, Cash, " +
      "CareCredit, Remote Payment...), card_brand the specific card. This is " +
      "CASH COLLECTED and is NOT the same as revenue billed (ezyvet_invoice_line): " +
      "a payment may settle an older invoice, and an invoice may go unpaid. " +
      "Use this for deposits, payment-mix and collections questions.",
  },
  payment_allocations: {
    title: "Payment Allocations",
    report: "Payment Allocations To Divisions",
    purpose: "How each payment was split across hospitals/divisions.",
    comment:
      "One row per payment-to-invoice allocation. Shows which division earned " +
      "the money when a payment taken at one hospital settles another's invoice. " +
      "divisional_amount is that division's share; total_payment_amount repeats " +
      "the whole payment, so NEVER sum total_payment_amount across rows.",
  },
  aged_receivables: {
    title: "Aged Receivables",
    report: "Aged Receivables",
    purpose: "Client accounts receivable, aged into 30/60/90+ day buckets.",
    comment:
      "Daily snapshot of client A/R (one row per client per snapshot_date, so " +
      "the aging can be trended). ezyVet names the aging columns after calendar " +
      "months, which move every month, so they are stored positionally: " +
      "bucket_current is the newest month, then bucket_30 / bucket_60 / " +
      "bucket_90_plus going further back. total_due is the balance owed. " +
      "Join to ezyvet_contact on contact_code.",
  },
  end_of_day_totals: {
    title: "End of Day Totals",
    report: "End of Day Totals",
    purpose: "Daily close: pending vs approved invoices, payments by type, debtor balances.",
    comment:
      "Long-form daily close figures — one row per metric per day. Metrics " +
      "include Pending Invoices, Approved Invoices, Opening Debtors, Closing " +
      "Debtors, Payments Received, plus one row per payment method. Query with " +
      "metric ILIKE, and remember amounts are practice-wide for that day.",
  },
  invoice_credit_summary: {
    title: "Invoices & Credits",
    report: "Invoice/Credit Summary",
    purpose: "Invoice-header level view: status, credits, amount due, pet and insurance.",
    comment:
      "One row per INVOICE (ezyvet_invoice_line holds the line detail, this holds " +
      "the header). Adds what lines cannot answer: status (Approved/Pending), " +
      "credits vs debits, amount still due, due date, and the pet the invoice was " +
      "for. Re-read on a rolling window and upserted, because invoices flip from " +
      "Pending to Approved days later.",
  },
  unapplied_payments: {
    title: "Unapplied Payments & Credits",
    report: "Unapplied Payments and Credits",
    purpose: "Client money received but not yet allocated to an invoice.",
    comment:
      "Payments and credits sitting unapplied on client accounts. Amounts are " +
      "negative (money held). A row disappearing means it was applied, so this " +
      "is a worklist, not a ledger.",
  },
  taxable_sales: {
    title: "Taxable Sales",
    report: "Taxable Sales",
    purpose: "Invoiced totals and tax collected per tax code, per department.",
    comment:
      "Tax-code totals for the pulled window, grouped by department (the " +
      "department section drives location_key). Used for tax remittance and to " +
      "reconcile taxable vs exempt sales.",
  },
  disabled_records: {
    title: "Disabled Records",
    report: "Disabled Records",
    purpose: "Audit trail of voided/disabled invoices and payments.",
    comment:
      "Invoices and payments that were disabled (voided), with who did it and " +
      "when. Financial-control surface: a spike here, or voids by one user, is " +
      "worth investigating. Usually empty on a normal day.",
  },
  staff_sales: {
    title: "Staff Sales & Gross Profit",
    report: "Staff Sales",
    purpose: "Per-invoice turnover and GROSS PROFIT credited to the staff member who raised it.",
    comment:
      "One row per invoice per staff member, with turnover and gross profit in " +
      "dollars and percent. This is the ONLY source of margin in the warehouse — " +
      "ezyvet_invoice_line carries revenue but no cost. Note gross profit only " +
      "counts products that have a cost price and markup. staff_member is the " +
      "SALESPERSON who raised the invoice, not the case-owning doctor.",
  },
  customer_invoice_statistics: {
    title: "Customer Invoice Statistics",
    report: "Customer Invoice Statistics",
    purpose: "Per-client spend, gross profit, invoice counts and averages for the window.",
    comment:
      "Per-client totals for the pulled window: turnover, gross profit, number " +
      "of invoices and lines, and the averages per invoice and per line. Good " +
      "for client-value and basket-size questions; matched on name/email since " +
      "the report does not export the contact code.",
  },
  appointment_status: {
    title: "Appointment Status Timings",
    report: "Appointment Status",
    purpose: "Per-appointment minutes spent in each status — wait times and throughput.",
    comment:
      "One row per appointment, with the MINUTES it spent in each ezyVet status " +
      "(mins_in_waiting_room, mins_in_consultation, mins_in_hospital...) and " +
      "mins_to_complete. This is the operational counterpart to the agenda " +
      "counts: use it for wait times, room/doctor throughput and how long visit " +
      "types really take. time_to_complete reads 'Not Complete' (and " +
      "mins_to_complete is null) when the appointment was never finished, which " +
      "is common — filter those out before averaging.",
  },
  appointment_type: {
    title: "Appointment Type Summary",
    report: "Appointment Type",
    purpose: "Count and average/total minutes per appointment type per hospital.",
    comment:
      "Aggregated per appointment type and division for the pulled window: how " +
      "many were booked and the average and total minutes. Use this to size " +
      "scheduling templates against how long visits actually take.",
  },
  unbilled_consults: {
    title: "Unbilled Consults",
    report: "Unbilled Consult Appointments",
    purpose: "Consult appointments with no invoice — missed charges to chase.",
    comment:
      "Consults that happened but were never invoiced: the daily missed-revenue " +
      "worklist. Re-read over a rolling two-week window, so a consult that gets " +
      "invoiced later simply drops out of the table.",
  },
  estimate_status: {
    title: "Estimates",
    report: "Estimate Status",
    purpose: "Every estimate and its stage — the quote-to-acceptance funnel.",
    comment:
      "One row per estimate with its status (Created / Sent / Accepted / " +
      "Declined), value and originating doctor. Conversion rate = accepted " +
      "value over total value. date_sent is null while the estimate is unsent " +
      "(date_sent_raw then reads 'Not Sent'). Re-read on a rolling window and " +
      "upserted, since estimates change status days after they are written.",
  },

  consult_metrics: {
    title: "Consult Metrics",
    report: "Consult Metrics",
    purpose: "Clinical case mix: presenting and master problems per consult and doctor.",
    comment:
      "One row per clinical record: the case owner, the pet (species, breed, " +
      "weight, date of birth) and the MASTER and PRESENTING PROBLEMS. This is " +
      "the only source of what we actually treat, so use it for case-mix, " +
      "caseload-by-condition and per-doctor clinical questions. Problems are " +
      "free text and may list several separated by commas, so match with ILIKE.",
  },
  clinical_note_approval: {
    title: "Clinical Note Approval",
    report: "Clinical Note Approval",
    purpose: "Medical-record completion: which notes are approved, by whom and when.",
    comment:
      "One row per clinical note (SOAP and similar) with its approver and " +
      "created/approved/modified timestamps. approved_by null means the record " +
      "is still unapproved — the medical-records compliance backlog. Rebuilt " +
      "over a rolling 30-day window each run.",
  },
  controlled_drug: {
    title: "Controlled Drugs",
    report: "Controlled Drug",
    purpose: "Controlled-substance dispensing log for DEA reporting.",
    comment:
      "Every controlled-substance dispense: product, prescriber and DEA number, " +
      "quantity, quantity on hand, and the pet/client it was dispensed for. " +
      "dispensed_qty is negative for a dispense. Client date of birth, phone " +
      "and address ARE in the ezyVet export but are deliberately not stored. " +
      "Note ezyVet's export is column-shifted, so the clinic arrives under its " +
      "'Batch' header and is stored as division; batch number is not available.",
  },
  vaccinations: {
    title: "Vaccinations",
    report: "Vaccinations",
    purpose: "Vaccinations given, with next-due dates for compliance and recall.",
    comment:
      "One row per vaccination administered: product, quantity, the vet who " +
      "gave it, the date, and next_date for the reminder. is_historical marks " +
      "vaccinations recorded from an outside clinic rather than given here.",
  },
  soc_overdue: {
    title: "Standard of Care Overdue",
    report: "SOC Overdue with Upcoming Appointments",
    purpose: "Pets with overdue standard-of-care items who already have an appointment booked.",
    comment:
      "The pre-visit preparation worklist: pets with an overdue standard-of-care " +
      "item (vaccine, test, treatment) AND an upcoming appointment, so the team " +
      "can add it before the visit. days_overdue is how late the item is, " +
      "days_until_appt how soon they are coming in. Daily snapshot — filter to " +
      "the latest snapshot_date, and note the same pet appears once per overdue item.",
  },
  wellness_plan_use: {
    title: "Wellness Plan Use",
    report: "Wellness Plan Use",
    purpose: "Membership benefit utilisation: what is allocated, used and remaining.",
    comment:
      "One row per pet per plan benefit per snapshot: allocated, used and " +
      "available. Unused 'available' benefits are the practice's outstanding " +
      "liability and the reason to recall the client. Large table (~20k rows " +
      "per snapshot), so always filter to one snapshot_date and aggregate.",
  },

  inventory_value: {
    title: "Inventory Value",
    report: "Inventory Value",
    purpose: "Stock on hand and the dollars tied up in it, per product per day.",
    comment:
      "Daily snapshot of stocked products: quantity in inventory, current and " +
      "weighted-average unit cost, and total value. Trend total_inventory_value " +
      "by snapshot_date for stock levels over time. Negative quantities are " +
      "real in ezyVet (items sold that were never received) and flag count errors.",
  },
  expiring_inventory: {
    title: "Expiring Inventory",
    report: "Expiring Inventory",
    purpose: "Batches expiring in the next six months — waste prevention worklist.",
    comment:
      "Product batches with an expiry date inside the look-ahead window, with " +
      "quantity and the cost at risk. Daily snapshot; use the latest " +
      "snapshot_date and order by expiry_date to work the list.",
  },
  expired_inventory: {
    title: "Expired Inventory",
    report: "Expired Inventory",
    purpose: "Batches already past their expiry date that are still in stock.",
    comment:
      "Stock that has already expired and should be pulled and written off. " +
      "Daily snapshot — anything appearing here is a live problem.",
  },
  inventory_ordering: {
    title: "Inventory Ordering",
    report: "Inventory Ordering",
    purpose: "Reorder worklist with stock turns: what to order and how fast it moves.",
    comment:
      "Daily snapshot of the ordering position per product: in inventory, " +
      "available, on order, receipting, short, and to_order, plus inventory " +
      "turns for last month, the last 12 months and the monthly average. " +
      "to_order > 0 is the buy list; low turns with high stock is dead money.",
  },
  inventory_transfer: {
    title: "Inventory Transfers",
    report: "Inventory Transfer",
    purpose: "Stock moved between locations, with reason and value.",
    comment:
      "Stock movements between inventory locations: product, quantity, reason, " +
      "per-unit cost and total. Explains why a clinic's stock changed without a " +
      "sale, and surfaces stock quietly shifting between hospitals.",
  },
  purchases: {
    title: "Purchases",
    report: "Purchases",
    purpose: "What was bought from suppliers: product, quantity and spend.",
    comment:
      "Purchase-order lines received from suppliers over a rolling window: " +
      "product, quantity, unit price and totals excluding and including tax. " +
      "The source for supplier spend and COGS-side questions; ties to the " +
      "vendor CRM by supplier code.",
  },
};
