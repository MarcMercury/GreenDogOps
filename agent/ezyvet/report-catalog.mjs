// Central registry of every ezyVet Report-Center report the agent pulls.
//
// One entry per report, shared by the CSV sampler (sample-reports.mjs, used to
// discover column layouts) and the daily worker (extra-reports.mjs). Keeping
// the form quirks here means the download recipe for a report is described in
// exactly one place.
//
//   key       agent_report.key + the table/endpoint slug
//   name      EXACT Report Center catalog name (used by openReport)
//   endpoint  /api/agents/<endpoint> data sink
//   dates     how the form's date inputs are filled:
//               "range"  From/To = the target day (sdate/edate or Dates[...])
//               "end"    single end date + optional "as at" date
//               "at"     single as-at snapshot date
//               "ahead"  single end date set `aheadDays` into the FUTURE
//               "none"   snapshot report, no date inputs
//   configure optional extra form setup (checkboxes, dropdowns)
//   window    for "range" reports, how many days back the From date goes
//             (default 0 = single target day)
import { setDateValue } from "./report-center.mjs";

/**
 * Tick a checkbox by field name. Many ezyVet checkboxes ship a hidden input of
 * the SAME name carrying the unchecked value, so target the checkbox itself.
 */
async function setCheckbox(page, name, checked) {
  await page.evaluate(({ name, checked }) => {
    const el = document.querySelector(`input[type="checkbox"][name="${CSS.escape(name)}"]`);
    if (!el || el.checked === checked) return;
    el.checked = checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { name, checked });
  await page.waitForTimeout(200);
}

/** Select a radio by field name + value. */
async function setRadio(page, name, value) {
  await page.evaluate(({ name, value }) => {
    for (const el of document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)) {
      if (el.value !== value) continue;
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { name, value });
  await page.waitForTimeout(200);
}

// ezyVet SAVES a report's filter selections when you Print it, and reapplies
// them next time — so a colleague's "just Sherman Oaks, status Complete" run
// silently scopes ours too. Every filter is blanked before each run and only
// the ones we actually want are set. Each filter is a visible text input
// showing the label plus a hidden input (this list) holding the id.
const FILTER_FIELDS = [
  "resourcedata_osr_ownership", "ownershipseparation_id", "divisionSeparation",
  "DepartmentDropDown", "Department", "locationSeparation",
  "appointmentdata_type", "appointmentdata_status", "appointmenttype_id",
  "appointmentstatus_ids[]", "resource_id",
  "contact_id", "suppliercontact_id", "business_id", "user_id", "creatingUserId",
  "product_id", "productgroup_id", "productdata_financialproductgroup", "Product",
  "Product Group", "withTag", "productTag", "contactTags[]", "hearAboutTag",
  "financialCustomerGroupTag", "paymentmethod_id", "paymentterms_id",
  "consultdata_caseowner", "consultdata_animal", "animaldata_clientcontact",
  "animaldata_species", "therapeutic_id", "masterproblem_id",
  "presentingproblem_id", "approvedBy", "animalId", "consultId", "caseOwnerId",
  "WellnessPlan", "forWellnessPlan", "recordfilter_id", "cardTypeFilter",
  "CardBrandFilter", "sheltergroup", "shelterresource", "shelterstatus",
];

/**
 * Blank every saved filter on the open report form so the export covers the
 * whole practice. The visible label input is the text input immediately
 * preceding the hidden id input in document order.
 */
export async function clearReportFilters(page, keep = []) {
  const cleared = await page.evaluate(({ names, keep }) => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const done = [];
    for (const name of names) {
      if (keep.includes(name)) continue;
      const idx = inputs.findIndex((el) => el.name === name && el.type === "hidden");
      if (idx < 0) continue;
      const hidden = inputs[idx];
      if (hidden.value === "" || hidden.value === "0") continue;
      hidden.value = "";
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = idx - 1; i >= 0 && i > idx - 4; i--) {
        if (inputs[i].type !== "text") continue;
        inputs[i].value = "";
        inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      done.push(name);
    }
    return done;
  }, { names: FILTER_FIELDS, keep });
  await page.waitForTimeout(300);
  return cleared;
}

export const EXTRA_REPORTS = [
  // ── Financial: cash, receivables, close ────────────────────────────────────
  {
    key: "payment_summary",
    name: "Payment Summary",
    endpoint: "ezyvet/payment-summary",
    dates: "range",
    // Break the totals out by card type so the deposit reconciles.
    configure: (page) => setCheckbox(page, "showCardTypes", true),
  },
  {
    key: "payment_allocations",
    name: "Payment Allocations To Divisions",
    endpoint: "ezyvet/payment-allocations",
    dates: "range",
  },
  {
    key: "aged_receivables",
    name: "Aged Receivables",
    endpoint: "ezyvet/aged-receivables",
    dates: "end",
    // "basic" strips the lifetime-spend columns; keep them, they are useful.
    configure: (page) => setCheckbox(page, "excludeinactive", true),
  },
  {
    key: "end_of_day_totals",
    name: "End of Day Totals",
    endpoint: "ezyvet/end-of-day",
    dates: "end",
    // "For Day" (not "For Period") so opening/closing debtors are included.
    configure: (page) => setRadio(page, "usedaterange", "0"),
  },
  {
    key: "invoice_credit_summary",
    name: "Invoice/Credit Summary",
    endpoint: "ezyvet/invoice-summary",
    dates: "range",
  },
  {
    key: "unapplied_payments",
    name: "Unapplied Payments and Credits",
    endpoint: "ezyvet/unapplied-payments",
    dates: "range",
  },
  {
    key: "taxable_sales",
    name: "Taxable Sales",
    endpoint: "ezyvet/taxable-sales",
    dates: "range",
  },
  {
    key: "disabled_records",
    name: "Disabled Records",
    endpoint: "ezyvet/disabled-records",
    dates: "range",
  },
  {
    key: "staff_sales",
    name: "Staff Sales",
    endpoint: "ezyvet/staff-sales",
    dates: "range",
  },
  {
    key: "customer_invoice_statistics",
    name: "Customer Invoice Statistics",
    endpoint: "ezyvet/customer-invoice-stats",
    dates: "range",
  },

  // ── Appointments / operations ──────────────────────────────────────────────
  {
    key: "appointment_status",
    name: "Appointment Status",
    endpoint: "ezyvet/appointment-status",
    dates: "range",
    configure: async (page) => {
      await setCheckbox(page, "splitByDivision", true);
      await setCheckbox(page, "includeDecimals", true);
    },
  },
  {
    key: "appointment_type",
    name: "Appointment Type",
    endpoint: "ezyvet/appointment-type",
    dates: "range",
    configure: (page) => setCheckbox(page, "splitByDivision", true),
  },
  {
    key: "unbilled_consults",
    name: "Unbilled Consult Appointments",
    endpoint: "ezyvet/unbilled-consults",
    dates: "range",
    // Unbilled work can sit for a while — look back a fortnight each run.
    window: 14,
  },
  {
    key: "estimate_status",
    name: "Estimate Status",
    endpoint: "ezyvet/estimate-status",
    dates: "range",
    // Estimates convert days later, so keep re-reading a rolling window.
    window: 30,
  },

  // ── Clinical / compliance ──────────────────────────────────────────────────
  {
    key: "consult_metrics",
    name: "Consult Metrics",
    endpoint: "ezyvet/consult-metrics",
    dates: "range",
  },
  {
    key: "clinical_note_approval",
    name: "Clinical Note Approval",
    endpoint: "ezyvet/clinical-notes",
    dates: "range",
    window: 30,
  },
  {
    key: "controlled_drug",
    name: "Controlled Drug",
    endpoint: "ezyvet/controlled-drug",
    dates: "range",
  },
  {
    key: "vaccinations",
    name: "Vaccinations",
    endpoint: "ezyvet/vaccinations",
    dates: "range",
  },
  {
    key: "soc_overdue",
    name: "SOC Overdue with Upcoming Appointments",
    endpoint: "ezyvet/soc-overdue",
    dates: "none",
    configure: async (page) => {
      await setCheckbox(page, "data[ActiveOnly]", true);
      await setCheckbox(page, "data[ExcludeDeceased]", true);
    },
  },
  {
    key: "wellness_plan_use",
    name: "Wellness Plan Use",
    endpoint: "ezyvet/wellness-plan-use",
    dates: "at",
    atField: "AtDate_datetext",
  },

  // ── Inventory / supply chain ───────────────────────────────────────────────
  {
    key: "inventory_value",
    name: "Inventory Value",
    endpoint: "ezyvet/inventory-value",
    dates: "range",
    configure: async (page) => {
      await setCheckbox(page, "excludeZero", true);
      await setCheckbox(page, "showUnitPrice", true);
    },
  },
  {
    key: "expiring_inventory",
    name: "Expiring Inventory",
    endpoint: "ezyvet/expiring-inventory",
    dates: "ahead",
    aheadDays: 180,
  },
  {
    key: "expired_inventory",
    name: "Expired Inventory",
    endpoint: "ezyvet/expired-inventory",
    dates: "none",
  },
  {
    key: "inventory_ordering",
    name: "Inventory Ordering",
    endpoint: "ezyvet/inventory-ordering",
    dates: "none",
  },
  {
    key: "inventory_transfer",
    name: "Inventory Transfer",
    endpoint: "ezyvet/inventory-transfer",
    dates: "range",
    window: 30,
    configure: (page) => setCheckbox(page, "usedaterange", true),
  },
  {
    key: "purchases",
    name: "Purchases",
    endpoint: "ezyvet/purchases",
    dates: "range",
    window: 120,
    configure: (page) => setRadio(page, "showlinedetails", "1"),
  },
];

// Deliberately NOT pulled:
//   Inventory Movement — never finishes generating (>3 min in the Report Queue)
//     and duplicates Inventory Value + Products Billed.
//   Received Invoices — this practice does not record supplier invoices in
//     ezyVet; the export is empty even over a 120-day window.

export const EXTRA_REPORTS_BY_KEY = new Map(EXTRA_REPORTS.map((r) => [r.key, r]));

/** Shift an ISO date by `days` (negative = earlier). */
export function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Apply a report's date inputs for `targetDate`, then run its `configure` hook.
 * Returns the {from, to} window actually requested so the ingest can scope its
 * rebuild to the same range.
 */
export async function applyReportForm(page, report, targetDate) {
  const to = targetDate;
  const from = shiftIso(targetDate, -(report.window ?? 0));

  await clearReportFilters(page, report.keepFilters ?? []);

  switch (report.dates) {
    case "range":
      // setDateRange is applied by runCsvReport; nothing extra to do here.
      break;
    case "end":
      await setDateValue(page, "edate", to);
      await setDateValue(page, "atdate", to).catch(() => {});
      break;
    case "at":
      await setDateValue(page, report.atField ?? "atdate", to);
      break;
    case "ahead":
      await setDateValue(page, "edate", shiftIso(targetDate, report.aheadDays ?? 90));
      break;
    case "none":
    default:
      break;
  }
  if (report.configure) await report.configure(page);
  return { from, to };
}
