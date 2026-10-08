// Canonical vocabulary for the recruiting pipeline's free-text columns.
//
// Hand entry and job-board postings produced many spellings of the same thing
// ("Veterinary Receptionist", "Receptionist", "In-House CSR"…). Every write
// path (Indeed/Gmail intake, AI import, the candidate form, the Indeed bulk
// script) runs values through these functions so the filters stay clean.
// Unrecognized values pass through trimmed, so genuinely new titles still save.
//
// Kept dependency-free so scripts/import_indeed_candidates.mjs can import it.

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

type Rule = [RegExp, string];

// Order matters: the first matching rule wins, so specific roles (managers,
// externs, mobile, dental) are tested before the broad "tech"/"CSR" patterns.
const POSITION_RULES: Rule[] = [
  [/^remote$|\bremote\b.*(csr|recep|client|customer)/, "Remote CSR"],
  [/(practice|office|hospital|er|hr|clinic) manager/, "Practice Manager"],
  [/extern/, "Extern"],
  [/intern/, "Intern"],
  [/volunteer/, "Volunteer"],
  [/non-?anesthetic|\bnad\b|dental tech|teeth ?clean/, "Dental Tech"],
  [/\bmpmv\b|\bmy pet\b|mobile|driver/, "Mobile Vet Tech / Driver"],
  [/limpieza|cleaning|janitor|^fac\b|facilit|maintenance|custodian/, "Facilities / Cleaning"],
  [/marketing/, "Marketing"],
  [/recruit/, "Recruiting Assistant"],
  [/executive assistant|^admin$|administrative|personal asst/, "Executive Assistant"],
  [/\bdvm\b|^veterinarian$|associate veterinarian|relief veterinarian/, "DVM"],
  [/exotic/, "Exotics RVT"],
  [/\b(senior|lead)\b.*\btech/, "Senior Vet Tech"],
  [/\brvt\b|\brtv\b|registered vet|licensed|certified vet/, "RVT"],
  [/^ct$|clinic tech/, "Clinic Tech"],
  [/kennel/, "Kennel Technician"],
  [/assistant|^asst$|animal care/, "Vet Assistant"],
  [/vet(erinary)? tech|technician|^vt\b/, "Vet Tech"],
  [/\bcsr\b|client serv|customer serv|recep/, "CSR"],
];

/** "Veterinary Receptionist" -> "CSR", "Remote Vet Receptionist" -> "Remote CSR". */
export function normalizePositionTitle(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  const s = v.toLowerCase();
  for (const [re, canonical] of POSITION_RULES) {
    if (re.test(s)) return canonical;
  }
  return v;
}

const STAGE_ALIASES: Record<string, string> = {
  applicant: "New Lead",
  lead: "New Lead",
  "new lead": "New Lead",
  reviewed: "New Lead",
  contacting: "Contacted",
  contacted: "Contacted",
  "phone interview": "Phone Screen",
  "phone screen": "Phone Screen",
  "in person / shadow": "Shadow Day",
  "shadow interview": "Shadow Day",
  "in-person / shadow day": "Shadow Day",
  "shadow day": "Shadow Day",
  "shadow": "Shadow Day",
  interview: "Interview",
  "zoom/virtual interview": "Interview",
  hire: "Hired",
  hired: "Hired",
  hold: "Hold for Future",
  "hold for future": "Hold for Future",
  "remain in contact": "Hold for Future",
  "did not respond": "No Response",
  "no response": "No Response",
  "no hire": "Passed",
  "not moving forward": "Passed",
  pass: "Passed",
  passed: "Passed",
  "do not contact again": "Passed",
  "declined offer": "Offer Declined",
  "offer declined": "Offer Declined",
  quit: "Separated",
  "no longer with us": "Separated",
  "seperated ( no rehire )": "Separated (No Rehire)",
  "separated (no rehire)": "Separated (No Rehire)",
  "decision needed": "Decision Needed",
  declined: "Declined",
  offer: "Offer",
  interviewed: "Interview",
};

/** "Pass" / "No hire" / "Not moving forward" -> "Passed", etc. */
export function normalizeStage(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  return STAGE_ALIASES[v.toLowerCase()] ?? v;
}

const SOURCE_RULES: Rule[] = [
  [/^yes$/, ""],
  [/indeed/, "Indeed"],
  [/^zip|^zr$/, "ZipRecruiter"],
  [/career ?builder|cereer builder/, "Career Builder"],
  [/linkedin/, "LinkedIn"],
  [/^fb$|facebook/, "Facebook"],
  [/social media/, "Social Media"],
  [/college|student|school/, "College / School"],
  [/bonus|referral|^ref$|^doc\??$/, "Personal Referral"],
  [/^walk|visited clinic/, "Walk-in"],
  [/^gd$|gd website|website inquiry/, "GD Website"],
  [/vet(erinary)? america/, "Veterinary America"],
  [/^nick$/, "Recruiter Outreach"],
  [/^vcn$|^mash$/, "Other"],
];

/** "BONUS in Jan 24'" -> "Personal Referral", "Nick social media" -> "Social Media". */
export function normalizeSource(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  const s = v.toLowerCase();
  for (const [re, canonical] of SOURCE_RULES) {
    if (re.test(s)) return canonical || null;
  }
  return v;
}

/** "Van Nuys, CA 91411" -> "Van Nuys". Matches the `location` table names. */
export function normalizeJobLocation(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  const s = v.toLowerCase();
  if (/\bremote\b/.test(s)) return "Remote";
  if (/van nuys/.test(s)) return "Van Nuys";
  if (/venice/.test(s)) return "Venice";
  if (/sherman oaks|^so$/.test(s)) return "Sherman Oaks";
  return v;
}

const PIPELINE_ALIASES: Record<string, string> = {
  "all in house positions, remote csr": "All In House Positions",
  "remote csr, hired": "Hired",
};

export function normalizePipeline(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  return PIPELINE_ALIASES[v.toLowerCase()] ?? v;
}
