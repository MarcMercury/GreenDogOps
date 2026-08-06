/**
 * Every column of the ezyVet "Animals" report, in report order. Shared by the
 * server page (to build the Supabase select) and the client table, so it must
 * NOT live in the "use client" module — a server component cannot read plain
 * exports out of a client module.
 */
export const PATIENT_COLUMNS = [
  { key: "animal_code", label: "Code", type: "text" },
  { key: "animal_name", label: "Name", type: "text" },
  { key: "species", label: "Species", type: "text" },
  { key: "breed", label: "Breed", type: "text" },
  { key: "sex", label: "Sex", type: "text" },
  { key: "color", label: "Color", type: "text" },
  { key: "age", label: "Age", type: "text" },
  { key: "date_of_birth", label: "D.O.B.", type: "date" },
  { key: "dob_is_estimated", label: "D.O.B. Est.", type: "bool" },
  { key: "weight_lb", label: "Weight (lb)", type: "number" },
  { key: "is_active", label: "Active", type: "bool" },
  { key: "has_passed_away", label: "Passed Away", type: "bool" },
  { key: "date_of_passing", label: "Date of Passing", type: "date" },
  { key: "cause_of_death", label: "Cause of Death", type: "text" },
  { key: "caution_status", label: "Caution", type: "text" },
  { key: "division", label: "Division", type: "text" },
  { key: "last_visit", label: "Last Visit", type: "date" },
  { key: "next_appointment", label: "Next Appt", type: "date" },
  { key: "master_problems", label: "Master Problems", type: "long" },
  { key: "animal_notes", label: "Notes", type: "long" },
  { key: "microchip_number", label: "Microchip", type: "text" },
  { key: "rabies_number", label: "Rabies #", type: "text" },
  { key: "rabies_number_date", label: "Rabies Date", type: "date" },
  { key: "last_vaccination_date", label: "Last Vacc.", type: "date" },
  { key: "last_vaccination_name", label: "Last Vacc. Name", type: "text" },
  { key: "next_vaccination_due", label: "Next Vacc. Due", type: "date" },
  { key: "next_vaccination_name", label: "Next Vacc. Name", type: "text" },
  { key: "latest_bcs", label: "B.C.S.", type: "text" },
  { key: "latest_ds", label: "D.S.", type: "text" },
  { key: "latest_temp", label: "Temp", type: "text" },
  { key: "insurance_supplier", label: "Insurer", type: "text" },
  { key: "insurance_number", label: "Insurance #", type: "text" },
  { key: "referring_clinic", label: "Referring Clinic", type: "text" },
  { key: "referring_vet", label: "Referring Vet", type: "text" },
  { key: "owner_full_name", label: "Owner", type: "text" },
  { key: "owner_business_name", label: "Owner Business", type: "text" },
  { key: "owner_title", label: "Owner Title", type: "text" },
  { key: "owner_contact_code", label: "Owner Code", type: "text" },
  { key: "owner_is_business", label: "Is Business", type: "bool" },
  { key: "email", label: "Email", type: "text" },
  { key: "home_email", label: "Home Email", type: "text" },
  { key: "business_email", label: "Business Email", type: "text" },
  { key: "accounts_email", label: "Accounts Email", type: "text" },
  { key: "mobile", label: "Mobile", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "fax", label: "Fax", type: "text" },
  { key: "opt_out_marketing", label: "Opt Out", type: "bool" },
  { key: "physical_street1", label: "Street 1", type: "text" },
  { key: "physical_street2", label: "Street 2", type: "text" },
  { key: "physical_suburb", label: "Neighborhood", type: "text" },
  { key: "physical_city", label: "City", type: "text" },
  { key: "physical_state", label: "State", type: "text" },
  { key: "physical_post_code", label: "Postcode", type: "text" },
  { key: "physical_country", label: "Country", type: "text" },
  { key: "postal_street1", label: "Postal Street 1", type: "text" },
  { key: "postal_street2", label: "Postal Street 2", type: "text" },
  { key: "postal_suburb", label: "Postal Neighborhood", type: "text" },
  { key: "postal_city", label: "Postal City", type: "text" },
  { key: "postal_state", label: "Postal State", type: "text" },
  { key: "postal_post_code", label: "Postal Postcode", type: "text" },
  { key: "postal_country", label: "Postal Country", type: "text" },
  { key: "ezyvet_created_at", label: "Created", type: "date" },
  { key: "ezyvet_created_by", label: "Created By", type: "text" },
  { key: "ezyvet_modified_at", label: "Modified", type: "date" },
] as const;

export type PatientRow = { id: string; ezyvet_animal_id: string } & Record<
  string,
  string | number | boolean | null
>;

/** Comma-separated column list for the Supabase select(). */
export const PATIENT_SELECT = [
  "id",
  "ezyvet_animal_id",
  ...PATIENT_COLUMNS.map((c) => c.key),
].join(", ");
