/**
 * Planning-guide track rules — the single source of truth for how a schedule
 * department turns into appointment-track columns, and which track an ezyVet
 * appointment type belongs in.
 *
 * Shared by the auto-generated guides on Daily Capacity and by the Biz Dev
 * planning-guide generator so both lay a day out the same way.
 */

export const DVM_COLORS = [
  "#2563eb",
  "#0d9488",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
];

export interface GuideTrack {
  name: string;
  color: string;
  /** Slot type code from APPOINTMENT_TYPES. */
  type: string;
}

/**
 * The appointment-track columns to scaffold for a department, derived from the
 * existing planning guides. Exam-style areas get one track per DVM plus a shared
 * Urgent Care lane; specialties get their own single track(s).
 */
export function guideTracksFor(deptName: string, dvmCount: number): GuideTrack[] {
  const n = deptName.toLowerCase();
  const dvms = Math.max(1, dvmCount);
  const exam = (label: string, type: string): GuideTrack[] =>
    Array.from({ length: dvms }, (_, i) => ({
      name: dvms > 1 ? `DVM ${i + 1} — ${label}` : label,
      color: DVM_COLORS[i % DVM_COLORS.length],
      type,
    }));

  if (n.includes("exotic")) {
    return [{ name: "Exotics", color: "#16a34a", type: "ex_sick" }];
  }
  if (/\bim\b/.test(n) || n.includes("internal")) {
    const cols: GuideTrack[] = [
      { name: "Internal Med", color: "#9333ea", type: "im" },
    ];
    if (dvms > 1) {
      cols.push({ name: "Dental Clinic", color: "#db2777", type: "dental" });
    }
    return cols;
  }
  if (n.includes("clinic") || n.includes("wellness") || n.includes("nad")) {
    return [
      ...exam("NAD / Clinic", "nad"),
      { name: "Urgent Care", color: "#d97706", type: "uc" },
    ];
  }
  // AP and any other exam-based area.
  return [
    ...exam("Exam", "nad"),
    { name: "Urgent Care", color: "#d97706", type: "uc" },
  ];
}

/** Match an ezyVet appointment type name to the planning slot-type palette. */
export function planningCodeFor(name: string): string | null {
  const n = name.toLowerCase();
  if (/exotic/.test(n)) {
    if (/recheck/.test(n)) return "ex_recheck";
    if (/well/.test(n)) return "ex_wellness";
    if (/groom|tech/.test(n)) return "ex_groom";
    return "ex_sick";
  }
  if (/urgent|emergen|\buc\b/.test(n)) return "uc";
  if (/dental|dentistry/.test(n)) return "dental";
  if (/acupunct/.test(n)) return "acu";
  if (/internal med|ultrasound|\bim\b|endoscop/.test(n)) return "im";
  if (/drop\s?off/.test(n)) return "drop";
  if (/tech/.test(n)) return "tech";
  if (/new animal|\bnad\b|\boe\b|wellness|annual|puppy|kitten/.test(n)) return "nad";
  if (/exam|consult|recheck|sick|visit/.test(n)) return "ve";
  return null;
}

/**
 * Which of a department's tracks an appointment type belongs in. Falls back to
 * the department's primary (first) track, which is how the hand-authored guides
 * read: anything that isn't explicitly Urgent Care sits in the main lane.
 */
export function trackForApptType(tracks: GuideTrack[], apptType: string): GuideTrack {
  const code = planningCodeFor(apptType);
  if (code) {
    const exact = tracks.find((t) => t.type === code);
    if (exact) return exact;
  }
  return tracks[0];
}
