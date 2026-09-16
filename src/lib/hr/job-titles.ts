/**
 * Canonical job titles for the HR roster.
 *
 * Roster titles were typed by hand and imported from several spreadsheets, so
 * the same role shows up under many spellings ("Vet Assistant" vs "Veterinary
 * Assistant", "Remote Admin" vs "Remote Administrator", stray trailing spaces).
 * Every write path runs values through `normalizeJobTitle` so the Title filter
 * on /hr stays deduplicated.
 *
 * House style: Vet → Veterinary, Tech → Technician, Admin → Administrator.
 */

/** Lookup form of a title: lowercased, punctuation dropped, spaces collapsed. */
function aliasKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Known variants → canonical title. Keys are written in plain text and are
 * matched via `aliasKey`, so hyphen/casing/punctuation variants of a key
 * ("In-House CSR", "in house csr", "Remote CSR?") all resolve to one entry.
 */
const TITLE_ALIASES: Record<string, string> = {
  // Veterinary support staff
  "vet assistant": "Veterinary Assistant",
  "vet asst": "Veterinary Assistant",
  "veterinary assistant": "Veterinary Assistant",
  "vet assistant trainee": "Veterinary Assistant Trainee",
  "veterinary assistant trainee": "Veterinary Assistant Trainee",
  "vet tech": "Veterinary Technician",
  "vet technician": "Veterinary Technician",
  "veterinary tech": "Veterinary Technician",
  "veterinary technician": "Veterinary Technician",
  "dental tech": "Dental Technician",
  "dental technician": "Dental Technician",
  "lead clinical tech": "Lead Clinical Technician",
  "lead clinical technician": "Lead Clinical Technician",
  "registered vet tech": "RVT",
  "registered vet technician": "RVT",
  "registered veterinary tech": "RVT",
  "registered veterinary technician": "RVT",
  "registered veterinary technician rvt": "RVT",
  rvt: "RVT",

  // Doctors
  dvm: "DVM",
  "doctor of veterinary medicine": "DVM",
  "relief vet": "Relief DVM",
  "relief dvm": "Relief DVM",
  "relief veterinarian": "Relief DVM",
  opthamologist: "Ophthalmologist",
  ophthalmologist: "Ophthalmologist",

  // Interns / students
  "vet intern": "Veterinary Intern",
  "veterinary intern": "Veterinary Intern",
  "foreign vet graduate intern": "Foreign Veterinary Graduate Intern",
  "foreign veterinary graduate intern": "Foreign Veterinary Graduate Intern",
  "foreign veterinary graduate internship": "Foreign Veterinary Graduate Intern",

  // Client service
  csr: "CSR",
  "csr lead": "CSR Lead",
  rcsr: "RCSR",
  "in house csr": "In-House CSR",
  "remote csr": "Remote CSR",
  "remote csr manager": "Remote CSR Manager",
  "remote csr admin": "Remote CSR / Administrator",

  // Administration
  "remote admin": "Remote Administrator",
  "remote administration": "Remote Administrator",
  "remote administrator": "Remote Administrator",
  "in house admin": "In-House Administrator",
  "in house administration": "In-House Administrator",
  "in house administrator": "In-House Administrator",
  "my pet admin": "My Pet Administrator",
  "my pet administration": "My Pet Administrator",
  "my pet administrator": "My Pet Administrator",
  "mp truck admin": "MP Truck Administrator",
  "mp truck administrator": "MP Truck Administrator",

  // Leadership
  coo: "COO",
  "chief operations officer": "COO",
  cfo: "CFO",
  "chief financial officer": "CFO",
  cmo: "CMO",
  "chief marketing officer": "CMO",
  cco: "CCO",
  "chief culture officer": "CCO",
};

/**
 * Collapse whitespace and map a raw title onto its canonical spelling.
 * Unknown titles are returned trimmed/space-collapsed but otherwise untouched.
 */
export function normalizeJobTitle(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return TITLE_ALIASES[aliasKey(cleaned)] ?? cleaned;
}
