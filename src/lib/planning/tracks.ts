/**
 * Planning-guide track rules — the single source of truth for how a schedule
 * department turns into appointment-track columns, and which track an ezyVet
 * appointment type belongs in.
 *
 * Shared by the auto-generated guides on Daily Capacity and by the Biz Dev
 * planning-guide generator so both lay a day out the same way.
 *
 * Each track carries a *cadence*: how often the lane books, which minute of the
 * half-hour it lands on, when it opens/closes, and the team's block. That is
 * what encodes the house rules for Van Nuys and Venice:
 *
 *   - AP patients are dropped off first thing and worked on through the day, so
 *     the AP lane is a staggered 15-minute drop-off window (8:15–9:30) and
 *     nothing after it.
 *   - NAD/OE books every 30 minutes on the :00 / :30 mark.
 *   - VE books every 30 minutes on the :15 / :45 mark, so NAD and VE alternate
 *     and the two teams' drop-offs never land on the same minute.
 *   - Tech and UC are rendered by whichever team is free, so they share one lane
 *     that sits on the :00 / :30 mark across both.
 *   - The NAD team blocks midday and the VE team blocks mid-afternoon, so one
 *     team is always covering the floor.
 *
 * Sherman Oaks does not run this layout and keeps the plain half-hour grid.
 */

export const DVM_COLORS = [
  "#2563eb",
  "#0d9488",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
];

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export interface TrackCadence {
  /** Minutes between consecutive bookable slots in this lane. */
  stepMinutes: number;
  /** Minute past the half-hour the lane lands on: 0 = :00/:30, 15 = :15/:45. */
  phaseMinutes: number;
  /** Lane opens no earlier than this (minutes from midnight); null = day open. */
  openMinute: number | null;
  /** Lane closes at this minute, exclusive; null = day close. */
  closeMinute: number | null;
  /** Team block (lunch / treatment time): nothing books in [start, end). */
  blockStartMinute: number | null;
  blockEndMinute: number | null;
}

const DEFAULT_CADENCE: TrackCadence = {
  stepMinutes: 30,
  phaseMinutes: 0,
  openMinute: null,
  closeMinute: null,
  blockStartMinute: null,
  blockEndMinute: null,
};

function cadence(overrides: Partial<TrackCadence> = {}): TrackCadence {
  return { ...DEFAULT_CADENCE, ...overrides };
}

export interface GuideTrack {
  name: string;
  color: string;
  /** Slot type code from APPOINTMENT_TYPES. */
  type: string;
  /** How this lane fills the day. */
  cadence: TrackCadence;
}

// ---------------------------------------------------------------------------
// House layout — Van Nuys and Venice
// ---------------------------------------------------------------------------

/** Locations that run the alternating NAD / VE drop-off layout. */
const ALTERNATING_LOCATION_CODES = new Set(["VAN", "VEN"]);

const M = (h: number, m = 0) => h * 60 + m;

/** AP drop-offs are staggered every 15 minutes across this window. */
const AP_DROPOFF_OPEN = M(8, 15);
const AP_DROPOFF_CLOSE = M(9, 45); // exclusive — the last drop-off is 9:30

/** NAD/OE team: early shift, midday block. */
const NAD_OPEN = M(8);
const NAD_CLOSE = M(17);
const NAD_BLOCK: readonly [number, number] = [M(12), M(14)];

/** VE team: late shift, mid-afternoon block (covers while NAD is blocked). */
const VE_OPEN = M(10);
const VE_CLOSE = M(20);
const VE_BLOCK: readonly [number, number] = [M(14), M(16)];

/** The shared UC / Tech lane runs the whole day on the half-hour mark. */
const SHARED_OPEN = M(8);
const SHARED_CLOSE = M(20);

/** The plain layout every other site (Sherman Oaks) keeps. */
const PLAIN_OPEN = M(9);
const PLAIN_CLOSE = M(17);
const PLAIN_LUNCH: readonly [number, number] = [M(12), M(12, 30)];

/** True when this location runs the alternating NAD / VE drop-off layout. */
export function usesAlternatingLayout(locationCode?: string | null): boolean {
  if (!locationCode) return false;
  return ALTERNATING_LOCATION_CODES.has(locationCode.trim().toUpperCase());
}

/** The clock window an auto-generated guide should span for a location. */
export function guideDayWindow(locationCode?: string | null): {
  startMinute: number;
  endMinute: number;
} {
  return usesAlternatingLayout(locationCode)
    ? { startMinute: SHARED_OPEN, endMinute: SHARED_CLOSE }
    : { startMinute: PLAIN_OPEN, endMinute: PLAIN_CLOSE };
}

// ---------------------------------------------------------------------------
// Department → tracks
// ---------------------------------------------------------------------------

export interface TrackOptions {
  /** Location short code (VAN / VEN / SO); drives the alternating layout. */
  locationCode?: string | null;
}

/**
 * The appointment-track columns to scaffold for a department. Exam-style areas
 * get one track per DVM plus the shared Urgent Care / Tech lane; specialties get
 * their own single track(s). Each track carries the cadence that lane books at,
 * so the generated grid reads like a real day rather than a uniform mesh.
 */
export function guideTracksFor(
  deptName: string,
  dvmCount: number,
  options: TrackOptions = {},
): GuideTrack[] {
  const n = deptName.toLowerCase();
  const dvms = Math.max(1, dvmCount);
  const alternating = usesAlternatingLayout(options.locationCode);
  const plain = cadence({
    blockStartMinute: PLAIN_LUNCH[0],
    blockEndMinute: PLAIN_LUNCH[1],
  });

  const lanes = (label: string, type: string, c: TrackCadence): GuideTrack[] =>
    Array.from({ length: dvms }, (_, i) => ({
      name: dvms > 1 ? `DVM ${i + 1} — ${label}` : label,
      color: DVM_COLORS[i % DVM_COLORS.length],
      type,
      cadence: c,
    }));

  // Tech and UC are rendered by whichever team is free, so both exam areas carry
  // the same shared lane on the half-hour mark.
  const sharedLane = (): GuideTrack => ({
    name: "Urgent Care / Tech",
    color: "#d97706",
    type: "uc",
    cadence: alternating
      ? cadence({ openMinute: SHARED_OPEN, closeMinute: SHARED_CLOSE })
      : plain,
  });

  if (n.includes("exotic")) {
    return [
      { name: "Exotics", color: "#16a34a", type: "ex_sick", cadence: plain },
    ];
  }
  if (/\bim\b/.test(n) || n.includes("internal")) {
    const cols: GuideTrack[] = [
      { name: "Internal Med", color: "#9333ea", type: "im", cadence: plain },
    ];
    if (dvms > 1) {
      cols.push({
        name: "Dental Clinic",
        color: "#db2777",
        type: "dental",
        cadence: plain,
      });
    }
    return cols;
  }
  // AP: patients are admitted in a staggered morning drop-off window and then
  // worked on through the rest of the day, so there is nothing else to book.
  if (/\bap\b/.test(n) || n.includes("advanced procedure")) {
    return [
      {
        name: "AP Drop-Off",
        color: "#0891b2",
        type: "drop",
        cadence: cadence({
          stepMinutes: 15,
          openMinute: AP_DROPOFF_OPEN,
          closeMinute: AP_DROPOFF_CLOSE,
        }),
      },
    ];
  }
  // VE / UC — the vet-exam team, offset half a slot from NAD.
  if (/\bve\b/.test(n) || n.includes("vet exam") || n.includes("urgent")) {
    return [
      ...lanes(
        "Vet Exam",
        "ve",
        alternating
          ? cadence({
              phaseMinutes: 15,
              openMinute: VE_OPEN,
              closeMinute: VE_CLOSE,
              blockStartMinute: VE_BLOCK[0],
              blockEndMinute: VE_BLOCK[1],
            })
          : plain,
      ),
      sharedLane(),
    ];
  }
  // NAD/OE, Clinic and Wellness — the new-animal / oral-exam team.
  if (
    n.includes("clinic") ||
    n.includes("wellness") ||
    n.includes("nad") ||
    /\boe\b/.test(n)
  ) {
    return [
      ...lanes(
        "NAD / OE",
        "nad",
        alternating
          ? cadence({
              openMinute: NAD_OPEN,
              closeMinute: NAD_CLOSE,
              blockStartMinute: NAD_BLOCK[0],
              blockEndMinute: NAD_BLOCK[1],
            })
          : plain,
      ),
      sharedLane(),
    ];
  }
  // Any other exam-based area.
  return [...lanes("Exam", "nad", plain), sharedLane()];
}

// ---------------------------------------------------------------------------
// Cadence → slot times
// ---------------------------------------------------------------------------

/**
 * Every bookable start time for a track inside a day window, honouring the
 * lane's step, phase, open/close and team block.
 */
export function trackSlotTimes(
  track: GuideTrack,
  dayStartMinute: number,
  dayEndMinute: number,
): number[] {
  const c = track.cadence;
  const step = Math.max(5, c.stepMinutes);
  const open = Math.max(dayStartMinute, c.openMinute ?? dayStartMinute);
  const close = Math.min(dayEndMinute, c.closeMinute ?? dayEndMinute);
  // Slots sit on a fixed phase within the step, so the 15-minute-offset lane
  // (VE) stays interleaved with the on-the-half-hour lanes (NAD / Tech).
  const phase = ((c.phaseMinutes % step) + step) % step;
  const first = Math.ceil((open - phase) / step) * step + phase;

  const out: number[] = [];
  for (let t = first; t < close; t += step) {
    const blocked =
      c.blockStartMinute != null &&
      c.blockEndMinute != null &&
      t >= c.blockStartMinute &&
      t < c.blockEndMinute;
    if (!blocked) out.push(t);
  }
  return out;
}

/** The [start, end) team-block window for a track, if it has one. */
export function trackBlockWindow(track: GuideTrack): [number, number] | null {
  const { blockStartMinute, blockEndMinute } = track.cadence;
  if (blockStartMinute == null || blockEndMinute == null) return null;
  return [blockStartMinute, blockEndMinute];
}

// ---------------------------------------------------------------------------
// Sizing a day to a target
// ---------------------------------------------------------------------------

/** Pick `keep` of `times`, evenly spread across the lane's hours. */
function spreadPick(times: number[], keep: number): number[] {
  if (keep >= times.length) return [...times];
  if (keep <= 0) return [];
  const chosen = new Set<number>();
  for (let i = 0; i < keep; i++) {
    let idx = Math.round((i * (times.length - 1)) / Math.max(1, keep - 1));
    while (chosen.has(idx) && idx < times.length - 1) idx++;
    while (chosen.has(idx) && idx > 0) idx--;
    chosen.add(idx);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => times[i]);
}

/** Split `total` across lanes in proportion to capacity (largest remainder). */
function allocate(capacities: number[], total: number): number[] {
  const sum = capacities.reduce((a, b) => a + b, 0);
  if (sum <= 0) return capacities.map(() => 0);
  if (total >= sum) return [...capacities];
  const exact = capacities.map((c) => (c * total) / sum);
  const out = exact.map((e) => Math.floor(e));
  let left = total - out.reduce((a, b) => a + b, 0);
  const byFraction = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byFraction) {
    if (left <= 0) break;
    if (out[i] < capacities[i]) {
      out[i]++;
      left--;
    }
  }
  // Anything still unplaced (lanes hit their cap) goes round-robin.
  while (left > 0) {
    const before = left;
    for (let i = 0; i < out.length && left > 0; i++) {
      if (out[i] < capacities[i]) {
        out[i]++;
        left--;
      }
    }
    if (left === before) break;
  }
  return out;
}

export interface TrackLayout {
  track: GuideTrack;
  /** Every start time this lane can offer on its cadence. */
  times: number[];
  /** The subset that is bookable once the day's target has been applied. */
  bookable: number[];
}

/**
 * Lay a day out across a department's tracks. Each lane fills on its own
 * cadence; when `targetAppointments` is below the day's full capacity the lanes
 * are trimmed in proportion and the survivors stay spread across the lane's
 * hours, so a light day thins out evenly instead of packing the morning.
 * A target of 0 means "fill the whole day".
 */
export function planTrackLayout(
  tracks: GuideTrack[],
  dayStartMinute: number,
  dayEndMinute: number,
  targetAppointments: number,
): { lanes: TrackLayout[]; total: number } {
  const times = tracks.map((t) => trackSlotTimes(t, dayStartMinute, dayEndMinute));
  const capacity = times.reduce((n, t) => n + t.length, 0);
  const target =
    targetAppointments > 0 ? Math.min(targetAppointments, capacity) : capacity;
  const keep = allocate(
    times.map((t) => t.length),
    target,
  );
  const lanes = tracks.map((track, i) => ({
    track,
    times: times[i],
    bookable: spreadPick(times[i], keep[i]),
  }));
  return { lanes, total: lanes.reduce((n, l) => n + l.bookable.length, 0) };
}

// ---------------------------------------------------------------------------
// Appointment type → track
// ---------------------------------------------------------------------------

/** Match an ezyVet appointment type name to the planning slot-type palette. */
export function planningCodeFor(name: string): string | null {
  const n = name.toLowerCase();
  if (/exotic|^ex\s*-/.test(n)) {
    if (/recheck/.test(n)) return "ex_recheck";
    if (/well/.test(n)) return "ex_wellness";
    if (/groom|tech/.test(n)) return "ex_groom";
    return "ex_sick";
  }
  if (/urgent|emergen|\buc\b/.test(n)) return "uc";
  if (/dental|dentistry/.test(n)) return "dental";
  if (/acupunct/.test(n)) return "acu";
  if (/internal med|ultrasound|\bim\b|endoscop/.test(n)) return "im";
  // AP patients are admitted as a staggered morning drop-off, not a timed exam.
  if (/drop\s?off|\bap\b|advanced procedure/.test(n)) return "drop";
  if (/tech|\bneat\b|nails|anal gland|bloodwork|imaging|\bvx\b/.test(n)) return "tech";
  if (/new animal|\bnad\b|\boe\b|oral exam|wellness|annual|puppy|kitten/.test(n)) {
    return "nad";
  }
  if (/exam|consult|recheck|sick|visit/.test(n)) return "ve";
  return null;
}

/**
 * When a department has no lane of the exact type, these are the lanes that
 * actually render that work — Tech and drop-offs ride the shared UC lane, and
 * VE / NAD cover for each other.
 */
const TRACK_FALLBACKS: Record<string, string[]> = {
  tech: ["uc", "nad", "ve"],
  drop: ["uc", "nad", "ve"],
  uc: ["ve", "nad"],
  ve: ["nad", "uc"],
  nad: ["ve", "uc"],
};

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
    for (const alt of TRACK_FALLBACKS[code] ?? []) {
      const near = tracks.find((t) => t.type === alt);
      if (near) return near;
    }
  }
  return tracks[0];
}
