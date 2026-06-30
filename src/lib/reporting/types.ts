// Shared types for the ezyVet Reporting and ezyVet CRM modules.
// These are safe to import from both client and server code.

/** A single parsed invoice line, ready to upsert into `ezyvet_invoice_line`. */
export interface InvoiceLineInput {
  invoice_line_id: string;
  invoice_no: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  line_date: string | null; // YYYY-MM-DD (service date)
  line_type: string | null;
  department_raw: string | null;
  location_key: LocationKey;
  location_label: string;
  inventory_location: string | null;
  client_contact_code: string | null;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  animal_code: string | null;
  pet_name: string | null;
  species: string | null;
  species_group: SpeciesGroup;
  breed: string | null;
  product_code: string | null;
  product_name: string | null;
  product_group: string | null;
  account: string | null;
  staff_member: string | null;
  staff_member_id: string | null;
  salesperson_is_vet: boolean | null;
  consult_id: string | null;
  qty: number | null;
  total_excl: number | null;
  total_incl: number | null;
}

/** A single parsed contact, ready to upsert into `ezyvet_contact`. */
export interface ContactInput {
  ezyvet_contact_id: string;
  contact_code: string | null;
  business_name: string | null;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  is_customer: boolean | null;
  is_business: boolean | null;
  is_vet: boolean | null;
  is_active: boolean | null;
  is_supplier: boolean | null;
  preferred_contact_method: string | null;
  physical_street1: string | null;
  physical_street2: string | null;
  physical_city: string | null;
  physical_state: string | null;
  physical_post_code: string | null;
  physical_country: string | null;
  number_of_miles: number | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  notes: string | null;
  account_code: string | null;
  last_invoiced: string | null;
  staff_member: string | null;
  hear_about: string | null;
  customer_group: string | null;
  regional_group: string | null;
  division: string | null;
  revenue_spend_ytd: number | null;
  opt_out_marketing: boolean | null;
  ezyvet_created_at: string | null;
  ezyvet_created_by: string | null;
  ezyvet_modified_at: string | null;
  ezyvet_modified_by: string | null;
}

export type LocationKey = "sherman_oaks" | "van_nuys" | "venice" | "other";
export type SpeciesGroup = "Dog" | "Cat" | "Exotic" | "Unknown";

// --- Read models returned by the reporting views ---------------------------

export interface ReportOverview {
  total_appointments: number;
  total_lines: number;
  total_revenue: number;
  first_date: string | null;
  last_date: string | null;
  unique_clients: number;
}

export interface MonthlyRow {
  month: string;
  appointments: number;
  revenue: number;
  line_count: number;
  pet_count: number;
  unique_clients: number;
}

export interface LocationMonthlyRow {
  month: string;
  location_key: LocationKey;
  location_label: string;
  appointments: number;
  revenue: number;
}

export interface LocationRow {
  location_key: LocationKey;
  location_label: string;
  appointments: number;
  revenue: number;
  unique_clients: number;
  avg_appointment_value: number;
}

export interface SpeciesRow {
  species_group: string;
  appointments: number;
  revenue: number;
}

export interface ProductGroupRow {
  product_group: string;
  line_count: number;
  revenue: number;
}

export interface TopProductRow {
  product_name: string;
  product_group: string;
  line_count: number;
  qty: number;
  revenue: number;
}

export interface ProductLocationRow {
  product_group: string;
  location_key: LocationKey;
  location_label: string;
  line_count: number;
  revenue: number;
}

export interface StaffRow {
  staff_member: string;
  is_vet: boolean;
  line_count: number;
  consults: number;
  appointments: number;
  revenue: number;
}

export interface StaffLocationRow {
  staff_member: string;
  location_key: LocationKey;
  location_label: string;
  line_count: number;
  revenue: number;
}

export interface ClientSummary {
  total_contacts: number;
  active_contacts: number;
  customers: number;
  businesses: number;
  total_revenue_ytd: number;
  avg_revenue_ytd: number;
}

export interface ClientsByMonthRow {
  month: string;
  new_clients: number;
}

export interface ClientGroupRow {
  customer_group?: string;
  division?: string;
  contacts: number;
  revenue_ytd: number;
}

export interface InvoiceImportRow {
  id: string;
  filename: string | null;
  label: string | null;
  total_rows: number;
  new_rows: number;
  skipped_rows: number;
  date_range_start: string | null;
  date_range_end: string | null;
  revenue_total: number;
  appointment_count: number;
  created_at: string;
}

export interface ContactImportRow {
  id: string;
  filename: string | null;
  total_rows: number;
  new_contacts: number;
  updated_contacts: number;
  unchanged_contacts: number;
  snapshot_date: string | null;
  created_at: string;
}

export const LOCATION_LABELS: Record<LocationKey, string> = {
  sherman_oaks: "Sherman Oaks",
  van_nuys: "Van Nuys",
  venice: "Venice",
  other: "Other",
};

export const LOCATION_COLORS: Record<LocationKey, string> = {
  sherman_oaks: "#10b981",
  van_nuys: "#6366f1",
  venice: "#0ea5e9",
  other: "#94a3b8",
};

export const SPECIES_COLORS: Record<string, string> = {
  Dog: "#10b981",
  Cat: "#f59e0b",
  Exotic: "#8b5cf6",
  Unknown: "#94a3b8",
};
