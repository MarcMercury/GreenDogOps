// Detailed appointment export via Dashboard ▸ Records.
//
// The Report-Center "Agenda" report only gives us per-resource counts. Driving
// the Records dashboard instead (Record Type = Appointment, Date >= / <=) and
// running Perform Action ▸ Export - Appointments produces the SAME Agenda CSV
// but in DETAILED mode — one row per appointment with its type, pet, owner,
// division, resource, status, description/notes and ezyVet ids — which is what
// appointment-type reporting and the Smart Report need.
//
// ezyVet refuses to export more than 10,000 records at once, so callers pass a
// short window (two months is safely under the cap at current volumes).
import { readFileSync } from "node:fs";
import { openRecordsTab, setRecordType, setDateWindow, showRecords, queueRecordExport } from "./records-dashboard.mjs";
import { snapshotQueue, downloadNewQueueCsv } from "./report-center.mjs";

/** ezyVet's hard cap on records per export action. */
export const EXPORT_RECORD_LIMIT = 10_000;

/** The Report Queue names this export under the underlying report. */
const QUEUE_REPORT_NAME = "Agenda";

// Advanced options on the Agenda output form. `detailed` is what turns the
// paper agenda into a one-row-per-appointment export; the rest widen it. We
// deliberately do NOT tick any hide_* option — the ezyVet ids are what let the
// ingest join appointments to ezyvet_contact / ezyvet_animal.
const EXPORT_OPTIONS = [
  "detailed",
  "show_addr",
  "show_enddate",
  "show_inactive", // include cancelled appointments
  "show_animal_referring",
  "show_consult_referring",
];

/**
 * Export every appointment in [fromIso, toIso] to a CSV.
 * @returns {Promise<{path: string|null, count: number|null}>}
 */
export async function exportAppointments(page, { fromIso, toIso, log = () => {} }) {
  await openRecordsTab(page, log);
  await setRecordType(page, "MetaAppointment", log);
  await setDateWindow(page, fromIso, toIso, log);

  const count = await showRecords(page, log);
  if (count === 0) {
    log(`no appointments in ${fromIso}..${toIso}`);
    return { count: 0 };
  }
  if (count !== null && count > EXPORT_RECORD_LIMIT) {
    throw new Error(
      `${count} appointments in ${fromIso}..${toIso} exceeds ezyVet's ${EXPORT_RECORD_LIMIT}-record export cap — use a shorter window.`,
    );
  }

  await queueRecordExport(page, { action: "ExportAppointments", checks: EXPORT_OPTIONS, log });
  return { count };
}

/** MM-DD-YYYY (the Agenda CSV's Date column) → YYYY-MM-DD. */
function fromEzyvetDate(value) {
  const m = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Reject a queue CSV whose Date column falls outside the requested window.
 * Several agents queue reports called "Agenda"; a scheduled look-ahead run
 * finishing mid-poll would otherwise be mistaken for this export.
 */
function windowValidator(fromIso, toIso) {
  return (path) => {
    const text = readFileSync(path, "utf8");
    const dates = new Set();
    for (const m of text.matchAll(/,(\d{2}-\d{2}-\d{4}),\d{2}:\d{2}[AP]M/g)) {
      const iso = fromEzyvetDate(m[1]);
      if (iso) dates.add(iso);
    }
    if (dates.size === 0) return "no dated rows";
    const outside = [...dates].filter((d) => d < fromIso || d > toIso);
    if (outside.length) return `covers ${[...dates].sort()[0]}..${[...dates].sort().pop()}, wanted ${fromIso}..${toIso}`;
    return null;
  };
}

/**
 * Full single-window run: baseline the Report Queue, export, download.
 * The baseline is taken BEFORE the export is queued (the queue retains prior
 * Agenda runs, and downloading the newest name match without a baseline can
 * grab a stale file).
 */
export async function runAppointmentWindow(page, { fromIso, toIso, downloadPath, log = () => {} }) {
  const before = await snapshotQueue(page, QUEUE_REPORT_NAME, log);
  const { count } = await exportAppointments(page, { fromIso, toIso, log });
  if (count === 0) return { path: null, count: 0 };
  const path = await downloadNewQueueCsv(page, {
    downloadPath,
    reportName: QUEUE_REPORT_NAME,
    before,
    timeoutMs: 900_000, // large windows take minutes to generate
    validate: windowValidator(fromIso, toIso),
    log,
  });
  return { path, count };
}

/** Split [startIso, endIso] into inclusive windows of `months` calendar months. */
export function monthWindows(startIso, endIso, months = 2) {
  const windows = [];
  const end = new Date(`${endIso}T00:00:00Z`);
  let cursor = new Date(`${startIso}T00:00:00Z`);
  while (cursor <= end) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + months, 1));
    const last = new Date(next.getTime() - 86_400_000);
    const to = last > end ? end : last;
    windows.push({ from: cursor.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    cursor = new Date(to.getTime() + 86_400_000);
  }
  return windows;
}
