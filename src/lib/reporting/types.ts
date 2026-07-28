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
  case_owner: string | null;
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

export interface CaseOwnerMonthRow {
  case_owner: string;
  month: string;
  line_count: number;
  revenue: number;
}

/**
 * One (doctor, department) production row from `report_dvm_by_dept`: the
 * doctor's revenue and appointments on days the published schedule placed them
 * in that department. On days split across departments the day's production is
 * divided evenly. Grouped by doctor for the collapsible "DVM by Dept" tab.
 */
export interface DvmDeptRow {
  year: number;
  doctor: string;
  department_name: string;
  department_color: string;
  department_sort: number;
  days_worked: number;
  appointments: number;
  revenue: number;
}

export interface StaffProductRow {
  product_name: string;
  product_group: string;
  line_count: number;
  qty: number;
  revenue: number;
}

export interface StaffProductGroupRow {
  product_group: string;
  line_count: number;
  revenue: number;
}

export interface StaffBreakdown {
  topGroups: StaffProductGroupRow[];
  topProducts: StaffProductRow[];
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

export interface ClientRecencyRow {
  sort_order: number;
  bucket: string;
  label: string;
  contacts: number;
  revenue_ytd: number;
}

export interface ClientRecencyLocationRow {
  location_key: LocationKey;
  location_label: string;
  location_order: number;
  sort_order: number;
  bucket: string;
  label: string;
  contacts: number;
  revenue_ytd: number;
}

export interface SpeciesPatientsRow {
  species_group: string;
  patients: number;
  clients: number;
  last_visit: string | null;
}

export interface SpeciesRecencyRow {
  species_group: string;
  sort_order: number;
  bucket: string;
  label: string;
  patients: number;
  clients: number;
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

/**
 * One (location, department, day) row of the Appointment Review report:
 * booked (expected) vs rendered (actual) appointment counts for a past day.
 * `rendered_count` is null when the day has not been re-scanned yet (pending).
 */
export interface AppointmentReviewRow {
  location_id: string;
  location_name: string;
  department_id: string;
  department_name: string;
  department_color: string | null;
  appt_date: string;
  expected_count: number;
  rendered_count: number | null;
  expected_snapshot: string | null;
  rendered_snapshot: string | null;
}

/**
 * One appointment behind an Appointment Review Cancelled/Moved or Added On
 * count. `change` is "dropped" (booked but absent from the post-day pull) or
 * "added" (present in the post-day pull but not the booked pull). `details`
 * carries every column from the Agenda CSV (original header -> value).
 */
export interface AppointmentReviewDetailRow {
  appt_date: string;
  change: "dropped" | "added";
  appt_key: string;
  client_name: string | null;
  patient_name: string | null;
  resource: string | null;
  appt_time: string | null;
  appt_type: string | null;
  status: string | null;
  details: Record<string, string> | null;
}

/**
 * One Appointment Review row grouped by the ezyVet appointment TYPE (the
 * category shown on each Agenda appointment): scheduled vs rendered for a past
 * date range, across all locations. `not_rendered` = scheduled - rendered
 * (cancelled / moved); `pending` = booked on days not yet re-scanned.
 */
export interface AppointmentReviewTypeRow {
  location_id: string;
  location_name: string;
  appt_type: string;
  scheduled: number;
  rendered: number;
  not_rendered: number;
  added: number;
  pending: number;
}

/**
 * One appointment of a given type that was NOT rendered (booked but absent from
 * the post-day pull = cancelled / moved) behind an Appointment Review by-type
 * count. `details` carries every column from the Agenda CSV.
 */
export interface AppointmentReviewTypeDetailRow {
  location_id: string;
  location_name: string;
  department_name: string;
  appt_date: string;
  appt_key: string;
  client_name: string | null;
  patient_name: string | null;
  resource: string | null;
  appt_time: string | null;
  appt_type: string | null;
  status: string | null;
  details: Record<string, string> | null;
}

/**
 * One appointment-type row of the ezyVet "Canceled Appointments" report:
 * how many appointments of that type were cancelled across all locations for a
 * past-date range.
 */
export interface CancelledApptTypeRow {
  location_id: string | null;
  location_name: string | null;
  appt_type: string;
  cancel_count: number;
}

/**
 * One cancelled appointment behind a cancels-by-type count, with its
 * cancellation reason and description.
 */
export interface CancelledApptDetailRow {
  appt_date: string;
  appt_type: string;
  location_id: string | null;
  location_name: string | null;
  start_time: string | null;
  with_who: string | null;
  using_resource: string | null;
  description: string | null;
  status: string | null;
  reason: string | null;
}

// --- Business Development planner -------------------------------------------

/** Which weekdays a clinic is open (drives the weekly/monthly roll-up). */
export interface BizDevOpenDays {
  open_sun: boolean;
  open_mon: boolean;
  open_tue: boolean;
  open_wed: boolean;
  open_thu: boolean;
  open_fri: boolean;
  open_sat: boolean;
}

/**
 * One planning row for the Business Development tab: a clinic's appointment
 * type with an editable average dollar value and an editable average count per
 * day — both BASE numbers derived from real data (value = revenue recovered by
 * bridging the Agenda to invoices through the contact record; avg_per_day = the
 * realized Agenda average). `planned_per_day` is the scenario count the user
 * models. `matched_paid` / `days_observed` are the sample sizes behind the
 * derived seeds (reference only).
 */
export interface BizDevApptTypeRow {
  id: string;
  location_id: string;
  appt_type: string;
  avg_value: number;
  avg_per_day: number;
  planned_per_day: number;
  /** Scenario count rendered per WEEK (used when cadence = "weekly"). */
  planned_per_week: number;
  /** Whether the planned volume is modeled per open day or per week. */
  cadence: "daily" | "weekly";
  /** Realistic capacity ceiling per day (0 = no cap). */
  max_per_day: number;
  /** Who renders this service: a doctor, a technician, or no provider. */
  provider_role: "dvm" | "tech" | "none";
  /** How many of THIS service one provider of that role renders per day (0 = unset). */
  per_provider_day: number;
  included: boolean;
  is_custom: boolean;
  sort_order: number;
  matched_paid: number;
  days_observed: number;
}

/** Day-of-week volume multipliers vs a typical weekday (1.0 = normal weekday). */
export interface BizDevWeekdayFactors {
  factor_sun: number;
  factor_mon: number;
  factor_tue: number;
  factor_wed: number;
  factor_thu: number;
  factor_fri: number;
  factor_sat: number;
}

/** Provider-backed capacity scenario for a clinic. */
export interface BizDevProviderCapacity {
  /** Doctors staffed on a typical open day. */
  dvm_count: number;
  /** Appointments one doctor renders per day (capacity). */
  appts_per_dvm_day: number;
  /** Scenario: extra doctors to add. */
  added_dvms: number;
  /** Technicians staffed on a typical open day. */
  tech_count: number;
  /** Scenario: extra technicians to add. */
  added_techs: number;
}

/** A clinic's full Business Development planning state. */
export interface BizDevLocation {
  location_id: string;
  location_key: LocationKey;
  location_label: string;
  /** Clinic blended average appointment value used to seed per-type values. */
  blended_avg_value: number;
  open_days: BizDevOpenDays;
  weekday_factors: BizDevWeekdayFactors;
  provider: BizDevProviderCapacity;
  /** Realized average booked appointments by hour-of-day (0..23) on a typical day. */
  hour_demand: { hour: number; avg_per_open_day: number }[];
  types: BizDevApptTypeRow[];
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
