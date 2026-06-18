// Default weekly schedule template — the standard set of shift lines that a new
// week starts from. Applied via the "Week Template" button. Times are 24h HH:MM.
//
// A department + role pair is the eligibility unit; the same role can appear on
// multiple shift lines (e.g. four "AP Tech" lines at different times all share
// the one "AP Tech" eligibility list).

export interface TemplateLine {
  role: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface TemplateDept {
  name: string;
  color: string;
  lines: TemplateLine[];
}

export const DEFAULT_WEEK_TEMPLATE: TemplateDept[] = [
  {
    name: "MANAGEMENT",
    color: "#475569",
    lines: [
      { role: "Manager", start: "10:00", end: "18:30" },
      { role: "Manager", start: "10:00", end: "18:30" },
      { role: "In House Admin", start: "10:00", end: "18:30" },
      { role: "Inventory", start: "09:30", end: "18:00" },
      { role: "Office Admin", start: "09:00", end: "17:30" },
    ],
  },
  {
    name: "VET-SURGERY",
    color: "#e11d48",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "Intern", start: "09:00", end: "18:30" },
      { role: "Extern/Student", start: "09:00", end: "17:30" },
      { role: "Surgery Lead", start: "08:30", end: "17:00" },
      { role: "Surgery Tech 1", start: "09:00", end: "17:30" },
      { role: "Surgery Tech 2", start: "09:00", end: "17:30" },
    ],
  },
  {
    name: "VET-AP",
    color: "#0d9488",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "Intern", start: "09:00", end: "18:30" },
      { role: "Extern/Student", start: "09:00", end: "17:30" },
      { role: "AP Lead", start: "10:00", end: "18:30" },
      { role: "AP Tech", start: "08:30", end: "17:00" },
      { role: "AP Tech", start: "09:00", end: "17:30" },
      { role: "AP Tech", start: "10:00", end: "18:30" },
      { role: "AP Tech", start: "09:30", end: "18:00" },
      { role: "Remote AP Tech", start: "09:00", end: "17:30" },
    ],
  },
  {
    name: "VET-NAD",
    color: "#2563eb",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "Intern", start: "09:00", end: "18:30" },
      { role: "Extern/Student", start: "09:00", end: "17:30" },
      { role: "DA - NAD", start: "09:00", end: "18:30" },
      { role: "DA - Training", start: "09:00", end: "18:30" },
      { role: "Clinic Tech", start: "08:30", end: "17:00" },
      { role: "Clinic Tech", start: "09:00", end: "17:30" },
      { role: "Clinic Tech", start: "10:00", end: "18:30" },
      { role: "Float / Lead", start: "10:00", end: "18:30" },
      { role: "Dentals", start: "09:00", end: "17:30" },
      { role: "Dentals", start: "09:30", end: "18:00" },
      { role: "Dentals (trainee)", start: "09:30", end: "18:00" },
    ],
  },
  {
    name: "VET-IM",
    color: "#7c3aed",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "Intern", start: "09:00", end: "18:30" },
      { role: "Extern/Student", start: "09:00", end: "17:30" },
      { role: "IM Tech/DA", start: "09:00", end: "17:30" },
      { role: "IM Tech", start: "09:00", end: "17:30" },
      { role: "IM Tech", start: "09:30", end: "18:00" },
    ],
  },
  {
    name: "VET-EXOTICS",
    color: "#16a34a",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "Intern", start: "09:00", end: "18:30" },
      { role: "Extern/Student", start: "09:00", end: "17:30" },
      { role: "Exotic Tech/DA", start: "09:00", end: "17:30" },
      { role: "Exotics Tech", start: "09:00", end: "17:30" },
      { role: "Exotics Tech", start: "09:30", end: "18:00" },
    ],
  },
  {
    name: "VET-MPMV",
    color: "#ea580c",
    lines: [
      { role: "DVM", start: "09:00", end: "18:30" },
      { role: "MPMV Tech", start: "09:00", end: "17:30" },
      { role: "MPMV Tech", start: "09:00", end: "17:30" },
      { role: "MPMV Tech", start: "09:00", end: "17:30" },
    ],
  },
  {
    name: "VET-CARDIO",
    color: "#db2777",
    lines: [{ role: "DVM", start: "09:00", end: "17:30" }],
  },
  {
    name: "CSR",
    color: "#0891b2",
    lines: [
      { role: "CSR Lead", start: "08:00", end: "16:30" },
      { role: "CSR", start: "08:00", end: "16:30" },
      { role: "CSR", start: "09:00", end: "17:30" },
      { role: "CSR", start: "10:00", end: "18:30" },
      { role: "CSR", start: "09:30", end: "18:00" },
      { role: "FAC", start: "08:30", end: "17:00" },
      { role: "Referral C", start: "09:30", end: "18:00" },
      { role: "In House Admin/Marketing Assist", start: "10:00", end: "18:30" },
    ],
  },
  {
    name: "REMOTE",
    color: "#6366f1",
    lines: [
      { role: "RCSR Manager", start: "09:00", end: "17:30" },
      { role: "RCSR Manager", start: "09:00", end: "17:30" },
      { role: "Morning Lead", start: "07:30", end: "16:00" },
      { role: "Mid", start: "08:00", end: "16:30" },
      { role: "AP/SX", start: "08:45", end: "17:15" },
      { role: "Support", start: "09:00", end: "17:30" },
      { role: "Closer", start: "09:45", end: "18:15" },
      { role: "Float", start: "10:30", end: "19:00" },
      { role: "Texting / Tidio", start: "08:00", end: "17:30" },
      { role: "In House Admin/Marketing Assist", start: "10:00", end: "18:30" },
    ],
  },
  {
    name: "MPMV MED TEAM",
    color: "#f97316",
    lines: [
      { role: "MPMV Med Team", start: "10:00", end: "18:30" },
      { role: "MPMV Med Team", start: "10:00", end: "18:30" },
      { role: "MPMV Med Team", start: "09:00", end: "17:30" },
    ],
  },
];
