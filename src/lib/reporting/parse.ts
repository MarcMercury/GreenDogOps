// CSV parsing + normalization for ezyVet exports. Pure functions, safe to run
// in the browser so large (6-10 MB) files never hit the server-action body
// limit — the client parses, then ships compact JSON batches to the server.

import type {
  ContactInput,
  InvoiceLineInput,
  LocationKey,
  SpeciesGroup,
} from "./types";

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

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function toNumber(v: string | undefined): number | null {
  const t = clean(v);
  if (t == null) return null;
  const num = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function toBool(v: string | undefined): boolean | null {
  const t = clean(v);
  if (t == null) return null;
  const u = t.toUpperCase();
  if (u === "YES" || u === "TRUE" || u === "1" || u === "Y") return true;
  if (u === "NO" || u === "FALSE" || u === "0" || u === "N") return false;
  return null;
}

/** ezyVet dates are MM-DD-YYYY. Returns ISO YYYY-MM-DD, or null. */
function toIsoDate(v: string | undefined): string | null {
  const t = clean(v);
  if (t == null) return null;
  // MM-DD-YYYY or MM/DD/YYYY
  const m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
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
function toIsoTimestamp(v: string | undefined): string | null {
  const t = clean(v);
  if (t == null) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
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
      phone: clean(get(row, "Phone Numbers")),
      mobile: clean(get(row, "Mobile Numbers")),
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
