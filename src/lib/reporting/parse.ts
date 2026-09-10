// CSV parsing + normalization for ezyVet exports. Pure functions, safe to run
// in the browser so large (6-10 MB) files never hit the server-action body
// limit — the client parses, then ships compact JSON batches to the server.

import type {
  AnimalInput,
  ContactInput,
  InvoiceLineInput,
  LocationKey,
  ProductInput,
  ProductPriceInput,
  SpeciesGroup,
} from "./types";
import { formatPhoneNumber } from "@/lib/shared/phone";

/**
 * Parse CSV text into an array of string-cell rows. Handles quoted fields,
 * escaped quotes ("") and CRLF / LF line endings. ezyVet exports are
 * comma-delimited with double-quote quoting.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the trailing field/row if the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Build a header -> column-index map (case/space-insensitive). */
function headerIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, idx) => map.set(normalizeHeader(h), idx));
  return map;
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function toNumber(v: string | undefined): number | null {
  const t = clean(v);
  if (t == null) return null;
  // Money and percentages both arrive decorated ($1,234.56 / 21.69%).
  const num = Number(t.replace(/[$,%]/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function toBool(v: string | undefined): boolean | null {
  const t = clean(v);
  if (t == null) return null;
  const u = t.toUpperCase();
  if (u === "YES" || u === "TRUE" || u === "1" || u === "Y") return true;
  if (u === "NO" || u === "FALSE" || u === "0" || u === "N") return false;
  return null;
}

/** ezyVet dates are MM-DD-YYYY. Returns ISO YYYY-MM-DD, or null. */
export function toIsoDate(v: string | undefined): string | null {
  const t = clean(v);
  if (t == null) return null;
  // MM-DD-YYYY or MM/DD/YYYY, optionally followed by a time ("09-09-2026 8:42am").
  const m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?![\d-/])/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Already ISO (optionally with a time component).
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** ezyVet "Created At" timestamps are "YYYY-MM-DD HH:MM:SS". */
export function toIsoTimestamp(v: string | undefined): string | null {
  const t = clean(v);
  if (t == null) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  // The Products report renders them as "MM-DD-YYYY h:mmam" instead.
  const us = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (us) {
    const [, mm, dd, yyyy, hhRaw, min, ampm] = us;
    let hh = Number(hhRaw);
    if (ampm) {
      const pm = ampm.toLowerCase() === "pm";
      if (hh === 12) hh = pm ? 12 : 0;
      else if (pm) hh += 12;
    }
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${min}:00Z`;
  }
  const d = toIsoDate(t);
  return d ? `${d}T00:00:00Z` : null;
}

/** Resolve clinic location from the Department / Inventory Location columns. */
export function resolveLocation(
  department: string | null,
  inventory: string | null,
): { key: LocationKey; label: string } {
  const hay = `${department ?? ""} ${inventory ?? ""}`.toLowerCase();
  if (hay.includes("sherman oaks"))
    return { key: "sherman_oaks", label: "Sherman Oaks" };
  if (hay.includes("van nuys")) return { key: "van_nuys", label: "Van Nuys" };
  if (hay.includes("venice")) return { key: "venice", label: "Venice" };
  return { key: "other", label: "Other" };
}

/** Bucket the raw ezyVet species string into Dog / Cat / Exotic / Unknown. */
export function resolveSpeciesGroup(species: string | null): SpeciesGroup {
  if (!species) return "Unknown";
  const s = species.toLowerCase();
  if (s.includes("canine") || s.includes("dog")) return "Dog";
  if (s.includes("feline") || s.includes("cat")) return "Cat";
  return "Exotic";
}

const INVOICE_REQUIRED = ["invoice line id"];

/**
 * Parse an invoice-line CSV into upsert-ready rows. Rows without an
 * "Invoice Line ID" (the dedup key) are skipped. Returns the rows plus the
 * count of skipped/invalid rows.
 */
export function parseInvoiceCsv(text: string): {
  rows: InvoiceLineInput[];
  skipped: number;
  error?: string;
} {
  const grid = parseCsv(text);
  if (grid.length < 2)
    return { rows: [], skipped: 0, error: "File appears to be empty." };
  const header = grid[0];
  const idx = headerIndex(header);
  for (const req of INVOICE_REQUIRED) {
    if (!idx.has(req))
      return {
        rows: [],
        skipped: 0,
        error: `Missing expected column "${req}". Is this an Invoice Lines export?`,
      };
  }
  const col = (name: string) => idx.get(normalizeHeader(name));
  const get = (r: string[], name: string): string | undefined => {
    const c = col(name);
    return c == null ? undefined : r[c];
  };

  const rows: InvoiceLineInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue; // blank line
    const lineId = clean(get(row, "Invoice Line ID"));
    if (!lineId || seen.has(lineId)) {
      skipped++;
      continue;
    }
    seen.add(lineId);

    const department = clean(get(row, "Department"));
    const inventory = clean(get(row, "Inventory Location"));
    const loc = resolveLocation(department, inventory);
    const species = clean(get(row, "Species"));

    rows.push({
      invoice_line_id: lineId,
      invoice_no: clean(get(row, "Invoice #")),
      invoice_date: toIsoDate(get(row, "Invoice Date")),
      line_date: toIsoDate(get(row, "Invoice Line Date")),
      line_type: clean(get(row, "Type")),
      department_raw: department,
      location_key: loc.key,
      location_label: loc.label,
      inventory_location: inventory,
      client_contact_code: clean(get(row, "Client Contact Code")),
      business_name: clean(get(row, "Business Name")),
      first_name: clean(get(row, "First Name")),
      last_name: clean(get(row, "Last Name")),
      email: clean(get(row, "Email")),
      animal_code: clean(get(row, "Animal Code")),
      pet_name: clean(get(row, "Pet Name")),
      species,
      species_group: resolveSpeciesGroup(species),
      breed: clean(get(row, "Breed")),
      product_code: clean(get(row, "Product Code")),
      product_name: clean(get(row, "Product Name")),
      product_group: clean(get(row, "Product Group")),
      account: clean(get(row, "Account")),
      staff_member: clean(get(row, "Staff Member")),
      staff_member_id: clean(get(row, "Staff Member ID")),
      salesperson_is_vet: toBool(get(row, "Salesperson is Vet")),
      case_owner: clean(get(row, "Case Owner")),
      consult_id: clean(get(row, "Consult ID")),
      qty: toNumber(get(row, "Qty")),
      total_excl: toNumber(get(row, "Total Invoiced (excl)")),
      total_incl: toNumber(get(row, "Total Invoiced (incl)")),
    });
  }
  return { rows, skipped };
}

const CONTACT_REQUIRED = ["contact id"];

/**
 * Parse a Contacts CSV into upsert-ready rows. Rows without a "Contact Id"
 * (the dedup key) are skipped.
 */
export function parseContactCsv(text: string): {
  rows: ContactInput[];
  skipped: number;
  error?: string;
} {
  const grid = parseCsv(text);
  if (grid.length < 2)
    return { rows: [], skipped: 0, error: "File appears to be empty." };
  const header = grid[0];
  const idx = headerIndex(header);
  for (const req of CONTACT_REQUIRED) {
    if (!idx.has(req))
      return {
        rows: [],
        skipped: 0,
        error: `Missing expected column "${req}". Is this a Contacts export?`,
      };
  }
  const col = (name: string) => idx.get(normalizeHeader(name));
  const get = (r: string[], name: string): string | undefined => {
    const c = col(name);
    return c == null ? undefined : r[c];
  };

  const rows: ContactInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const contactId = clean(get(row, "Contact Id"));
    if (!contactId || seen.has(contactId)) {
      skipped++;
      continue;
    }
    seen.add(contactId);

    const first = clean(get(row, "Contact First Name"));
    const last = clean(get(row, "Contact Last Name"));
    const business = clean(get(row, "Business Name"));
    const fullName =
      [first, last].filter(Boolean).join(" ").trim() || business || null;

    rows.push({
      ezyvet_contact_id: contactId,
      contact_code: clean(get(row, "Contact Code")),
      business_name: business,
      title: clean(get(row, "Contact Title")),
      first_name: first,
      last_name: last,
      full_name: fullName,
      date_of_birth: toIsoDate(get(row, "Contact Date of Birth")),
      is_customer: toBool(get(row, "Contact Is Customer")),
      is_business: toBool(get(row, "Contact Is Business")),
      is_vet: toBool(get(row, "Contact Is Vet")),
      is_active: toBool(get(row, "Contact Is Active")),
      is_supplier: toBool(get(row, "Contact Is Supplier")),
      preferred_contact_method: clean(
        get(row, "Contact Preferred Contact Method"),
      ),
      physical_street1: clean(get(row, "Contact Physical Street Line 1")),
      physical_street2: clean(get(row, "Contact Physical Street Line 2")),
      physical_city: clean(get(row, "Contact Physical City")),
      physical_state: clean(get(row, "Contact Physical State")),
      physical_post_code: clean(get(row, "Contact Physical Post Code")),
      physical_country: clean(get(row, "Contact Physical Country")),
      number_of_miles: toNumber(get(row, "Number of Miles")),
      email: clean(get(row, "Email Addresses")),
      phone: formatPhoneNumber(get(row, "Phone Numbers")),
      mobile: formatPhoneNumber(get(row, "Mobile Numbers")),
      website: clean(get(row, "Contact Website Address")),
      notes: clean(get(row, "Contact Notes")),
      account_code: clean(get(row, "Contact Account Code")),
      last_invoiced: toIsoDate(get(row, "Last Invoiced")),
      staff_member: clean(get(row, "Contact Staff Member")),
      hear_about: clean(get(row, "Contact Hear About Option")),
      customer_group: clean(get(row, "Customer Group")),
      regional_group: clean(get(row, "Contact Regional Contact Group")),
      division: clean(get(row, "Contact Division")),
      revenue_spend_ytd: toNumber(get(row, "Revenue Spend YTD")),
      opt_out_marketing: toBool(get(row, "Opt Out of Electronic Marketing")),
      ezyvet_created_at: toIsoTimestamp(get(row, "Contact Created At")),
      ezyvet_created_by: clean(get(row, "Contact Created By")),
      ezyvet_modified_at: toIsoTimestamp(get(row, "Contact Modified At")),
      ezyvet_modified_by: clean(get(row, "Contact Modified By")),
    });
  }
  return { rows, skipped };
}

/** Best-effort month label from a filename, e.g. "APRIL.csv" -> "April". */
export function labelFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

const ANIMAL_REQUIRED = ["animal id"];

/**
 * Parse an ezyVet "Animals" CSV export (the full patient roster with summaries)
 * into upsert-ready rows. Deduped on "Animal Id"; rows without one are skipped.
 */
export function parseAnimalCsv(text: string): {
  rows: AnimalInput[];
  skipped: number;
  error?: string;
} {
  const grid = parseCsv(text);
  if (grid.length < 2)
    return { rows: [], skipped: 0, error: "File appears to be empty." };
  const header = grid[0];
  const idx = headerIndex(header);
  for (const req of ANIMAL_REQUIRED) {
    if (!idx.has(req))
      return {
        rows: [],
        skipped: 0,
        error: `Missing expected column "${req}". Is this an Animals export?`,
      };
  }
  const col = (name: string) => idx.get(normalizeHeader(name));
  const get = (r: string[], name: string): string | undefined => {
    const c = col(name);
    return c == null ? undefined : r[c];
  };

  const rows: AnimalInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const animalId = clean(get(row, "Animal Id"));
    if (!animalId || seen.has(animalId)) {
      skipped++;
      continue;
    }
    seen.add(animalId);

    const ownerFirst = clean(get(row, "Owner First Name"));
    const ownerLast = clean(get(row, "Owner Last Name"));
    const ownerBusiness = clean(get(row, "Owner Business Name"));
    const ownerFull =
      [ownerFirst, ownerLast].filter(Boolean).join(" ").trim() ||
      ownerBusiness ||
      null;

    rows.push({
      ezyvet_animal_id: animalId,
      animal_code: clean(get(row, "Animal Code")),
      animal_name: clean(get(row, "Animal Name")),
      division: clean(get(row, "Division")),
      species: clean(get(row, "Species")),
      breed: clean(get(row, "Breed")),
      color: clean(get(row, "AnimalColor")),
      sex: clean(get(row, "Sex")),
      weight_lb: toNumber(get(row, "Animal Weight (lb)")),
      date_of_birth: toIsoDate(get(row, "Date of Birth")),
      dob_is_estimated: toBool(get(row, "D.O.B is Estimated")),
      age: clean(get(row, "Age")),
      is_active: toBool(get(row, "Active")),
      has_passed_away: toBool(get(row, "Has Passed Away")),
      date_of_passing: toIsoDate(get(row, "Date of Passing")),
      cause_of_death: clean(get(row, "Cause of Death")),
      caution_status: clean(get(row, "Caution Status")),
      microchip_number: clean(get(row, "Microchip Number")),
      rabies_number: clean(get(row, "Rabies Number")),
      rabies_number_date: toIsoDate(get(row, "Rabies Number Date")),
      last_vaccination_date: toIsoDate(get(row, "Last Vaccination Date")),
      last_vaccination_name: clean(get(row, "Last Vaccination Name")),
      next_vaccination_due: toIsoDate(get(row, "Next Vaccination Due")),
      next_vaccination_name: clean(get(row, "Next Vaccination Name")),
      master_problems: clean(get(row, "Master Problems")),
      animal_notes: clean(get(row, "Animal Notes")),
      last_visit: toIsoDate(get(row, "Last Visit")),
      next_appointment: toIsoDate(get(row, "Next Appointment")),
      latest_bcs: clean(get(row, "Latest B.C.S.")),
      latest_ds: clean(get(row, "Latest D.S.")),
      latest_temp: clean(get(row, "Latest Temp")),
      insurance_supplier: clean(get(row, "Insurance Supplier")),
      insurance_number: clean(get(row, "Insurance Number")),
      referring_clinic: clean(get(row, "Referring Clinic")),
      referring_vet: clean(get(row, "Referring Vet")),
      owner_contact_code: clean(get(row, "Owner Contact Code")),
      owner_business_name: ownerBusiness,
      owner_title: clean(get(row, "Owner Title")),
      owner_first_name: ownerFirst,
      owner_last_name: ownerLast,
      owner_full_name: ownerFull,
      owner_is_business: toBool(get(row, "Is Business")),
      opt_out_marketing: toBool(get(row, "Opt Out of Electronic Marketing")),
      email: clean(get(row, "Email Addresses")),
      home_email: clean(get(row, "Home Email Address")),
      business_email: clean(get(row, "Business Email Address")),
      accounts_email: clean(get(row, "Accounts Email Address")),
      phone: formatPhoneNumber(get(row, "Phone Numbers")),
      mobile: formatPhoneNumber(get(row, "Mobile Numbers")),
      fax: formatPhoneNumber(get(row, "Fax Numbers")),
      physical_street1: clean(get(row, "Physical Address Street 1")),
      physical_street2: clean(get(row, "Physical Address Street 2")),
      physical_suburb: clean(get(row, "Physical Address Suburb/Neighborhood")),
      physical_city: clean(get(row, "Physical Address City")),
      physical_state: clean(get(row, "Physical Address State")),
      physical_post_code: clean(get(row, "Physical Address Postcode")),
      physical_country: clean(get(row, "Physical Address Country")),
      postal_street1: clean(get(row, "Postal Address Street 1")),
      postal_street2: clean(get(row, "Postal Address Street 2")),
      postal_suburb: clean(get(row, "Postal Address Suburb/Neighborhood")),
      postal_city: clean(get(row, "Postal Address City")),
      postal_state: clean(get(row, "Postal Address State")),
      postal_post_code: clean(get(row, "Postal Address Postcode")),
      postal_country: clean(get(row, "Postal Address Country")),
      ezyvet_created_at: toIsoTimestamp(get(row, "Animal Record Created At")),
      ezyvet_created_by: clean(get(row, "Animal Record Created By")),
      ezyvet_modified_at: toIsoTimestamp(
        get(row, "Animal Record Last Modified At"),
      ),
    });
  }
  return { rows, skipped };
}

const PRODUCT_REQUIRED = ["product id"];

/**
 * Parse an ezyVet "Products" CSV export (the product catalog) into
 * upsert-ready rows. Deduped on "Product ID"; rows without one are skipped.
 * The report exports 107 columns — only the ones with reporting value are kept.
 */
export function parseProductCsv(text: string): {
  rows: ProductInput[];
  skipped: number;
  error?: string;
} {
  const grid = parseCsv(text);
  if (grid.length < 2)
    return { rows: [], skipped: 0, error: "File appears to be empty." };
  const idx = headerIndex(grid[0]);
  for (const req of PRODUCT_REQUIRED) {
    if (!idx.has(req))
      return {
        rows: [],
        skipped: 0,
        error: `Missing expected column "${req}". Is this a Products export?`,
      };
  }
  const get = (r: string[], name: string): string | undefined => {
    const c = idx.get(normalizeHeader(name));
    return c == null ? undefined : r[c];
  };

  const rows: ProductInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const productId = clean(get(row, "Product ID"));
    if (!productId || seen.has(productId)) {
      skipped++;
      continue;
    }
    seen.add(productId);

    rows.push({
      ezyvet_product_id: productId,
      product_code: clean(get(row, "Product Code")),
      product_name: clean(get(row, "Product Name")),
      description: clean(get(row, "Product Description")),
      product_group: clean(get(row, "Product Financial Product Group")),
      product_type: clean(get(row, "Product Product Type")),
      new_product_type: clean(get(row, "Product New Product Type")),
      clinical_type: clean(get(row, "Product Clinical Type")),
      bundle_type: clean(get(row, "Product Bundle")),
      is_fixed_price_bundle: toBool(get(row, "Fixed Price Bundle")),
      diagnostic_name: clean(get(row, "Product Diagnostic")),
      therapeutic_name: clean(get(row, "Product Therapeutic")),
      schedule_or_class: clean(get(row, "Product Schedule or Class")),
      is_active: toBool(get(row, "Product Active")),
      is_sold: toBool(get(row, "Product Is Sold")),
      is_purchased: toBool(get(row, "Product Is Purchased")),
      excluded_from_sales: toBool(get(row, "Product Excluded From Sales")),
      on_special: toBool(get(row, "Product On Special")),
      available_on_web: toBool(get(row, "Product Available On Web")),
      requires_prescription: toBool(get(row, "Product Requires Prescription")),
      generates_prescription: toBool(get(row, "Product Generates Prescription")),
      is_rvm_medication: toBool(get(row, "Product Is RVM Medication")),
      is_rabies_vax: toBool(get(row, "Product Is Rabies Vax")),
      can_expire: toBool(get(row, "Product Can Expire")),
      is_container: toBool(get(row, "Product Is Container")),
      is_template: toBool(get(row, "Product Is Template")),
      has_markup: toBool(get(row, "Product Has Markup")),
      stock_goes_negative: toBool(get(row, "Product Stock Goes Negative")),
      requires_freight: toBool(get(row, "Product Requires Freight")),
      tracking_level: clean(get(row, "Product Tracking Level")),
      rrp: toNumber(get(row, "Product RRP")),
      barcode: clean(get(row, "Product Barcode")),
      primary_barcode: clean(get(row, "Product Primary Barcode")),
      external_reference: clean(get(row, "Product External Reference")),
      secondary_external_reference: clean(
        get(row, "Product Secondary External Reference"),
      ),
      unique_identifier: clean(get(row, "Product Unique Identifier")),
      supplier: clean(get(row, "Product Supplier")),
      default_supplier: clean(get(row, "Product Default Supplier")),
      default_supplier_product_code: clean(
        get(row, "Product Default Supplier Product Code"),
      ),
      supplier_contact: clean(get(row, "Product Supplier Contact")),
      sales_account: clean(get(row, "Product Sales Account")),
      purchases_account: clean(get(row, "Product Purchases Account")),
      inventory_account: clean(get(row, "Product Inventory Account")),
      minimum_inventory: toNumber(get(row, "Product Minimum Inventory")),
      minimum_reorder: toNumber(get(row, "Product Minimum Reorder")),
      minimum_sell_units: toNumber(get(row, "Product Minimum Sell Units")),
      default_sell_units: toNumber(get(row, "Product Default Sell Units")),
      lowest_dispensable_unit: clean(get(row, "Product Lowest Dispensable Unit")),
      lowest_dispensable_quantity: toNumber(
        get(row, "Product Lowest Dispensable Quantity"),
      ),
      concentration: toNumber(get(row, "Product Concentration")),
      concentration_unit: clean(get(row, "Product Concentration Unit")),
      // ezyVet's own header typo ("Secords") — keep it verbatim.
      booster_duration_seconds: toNumber(
        get(row, "Product Booster Duration Secords"),
      ),
      default_vaccination_qty: toNumber(
        get(row, "Product Default Vaccination Issue Quantity"),
      ),
      last_invoiced_date: toIsoDate(get(row, "Last Invoiced Date")),
      notes: clean(get(row, "Product Notes")),
      notes_important: toBool(get(row, "Product Notes Important")),
      warning: clean(get(row, "Product Warning")),
      instructions: clean(get(row, "Product Instructions")),
      default_medication_text: clean(get(row, "Product Default Medication Text")),
      default_prescribing_user: clean(
        get(row, "Product Default Prescribing User"),
      ),
      ezyvet_created_at: toIsoTimestamp(get(row, "Product Creation Time")),
      ezyvet_created_by: clean(get(row, "Product Creating User")),
      ezyvet_modified_at: toIsoTimestamp(get(row, "Product Modified Time")),
      ezyvet_modified_by: clean(get(row, "Product Modifying User")),
    });
  }
  return { rows, skipped };
}

const PRICING_REQUIRED = ["code", "division"];

/**
 * Parse an ezyVet "Product Pricing" CSV export. One row per product per
 * division (prices are set per hospital), so the dedup key is Code + Division.
 */
export function parseProductPricingCsv(text: string): {
  rows: ProductPriceInput[];
  skipped: number;
  error?: string;
} {
  const grid = parseCsv(text);
  if (grid.length < 2)
    return { rows: [], skipped: 0, error: "File appears to be empty." };
  const idx = headerIndex(grid[0]);
  for (const req of PRICING_REQUIRED) {
    if (!idx.has(req))
      return {
        rows: [],
        skipped: 0,
        error: `Missing expected column "${req}". Is this a Product Pricing export?`,
      };
  }
  const get = (r: string[], name: string): string | undefined => {
    const c = idx.get(normalizeHeader(name));
    return c == null ? undefined : r[c];
  };

  const rows: ProductPriceInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const code = clean(get(row, "Code"));
    const division = clean(get(row, "Division"));
    const key = `${code}|${division}`;
    if (!code || !division || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    rows.push({
      product_code: code,
      division,
      product_name: clean(get(row, "Name")),
      product_group: clean(get(row, "Financial Product Group")),
      cost: toNumber(get(row, "Cost")),
      sell_price_excl: toNumber(get(row, "Sell Price Exc. TAX")),
      sell_price_incl: toNumber(get(row, "Sell Price Inc. TAX")),
      markup: toNumber(get(row, "Markup")),
      service_fee_product_id: clean(get(row, "Service Fee Product Id")),
      service_fee_product_code: clean(get(row, "Service Fee Product Code")),
      service_fee_product_ref: clean(
        get(row, "Service Fee Product External Reference"),
      ),
    });
  }
  return { rows, skipped };
}
