#!/usr/bin/env node
/**
 * Read the "GDD Staff Schedule 2026" Google Sheet.
 *
 * The sheet is shared read-only with the calendar-sync service account, so it
 * uses the same GOOGLE_SERVICE_ACCOUNT_JSON as the Calendar sync.
 *
 *   node scripts/read_schedule_sheet.mjs tabs
 *   node scripts/read_schedule_sheet.mjs extract September vet
 *   node scripts/read_schedule_sheet.mjs extract September ""     # every role
 *
 * Layout (verified on the September 2026 tab):
 *   - one block per week; the block header row has "WEEK n" in column B and a
 *     PUB / RTC publish flag in column C
 *   - header row     -> weekday names
 *   - header row + 1 -> day-of-month numbers (they wrap at month boundaries)
 *   - header row + 2 -> location sub-headers (SO / VENICE / AETNA)
 *   - column B = role label, column C = shift
 *   - each weekday spans 7 columns; locations sit at +0 / +2 / +4, except
 *     Sunday which is a narrow stub and must not read into Monday
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const SHEET_ID = "18DvLbxmzT-mmyaCRUW2xbzRxG4-HNPJS8rbUHZdNXdU";
const YEAR = 2026;
const ROOT = path.resolve(import.meta.dirname, "..");

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** SO / VENICE / AETNA as written in the sheet -> greendogops.location.name. */
export const SHEET_LOCATIONS = {
  SO: "Sherman Oaks",
  VENICE: "Venice",
  AETNA: "Van Nuys",
};

/** medical_board_type.key -> the sheet role rows that staff that board. */
export const BOARD_ROLE_ROWS = {
  ap: ["VET-AP", "2nd VET-AP"],
  clinic: ["VET-NAD", "2nd VET-NAD"],
  surgery: ["VET-SURGERY"],
  im: ["VET-IM"],
  cardio: ["VET-CARDIO"],
  exotics: ["VET-EXOTICS"],
  mpmv: ["VET-MPMV"],
};

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith(`${key}=`)) continue;
    let v = line.slice(key.length + 1).trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
}

function getSheetsClient() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    readEnvValue(path.join(ROOT, ".env.local"), "GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function listTabs() {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  console.log(data.properties?.title);
  for (const s of data.sheets ?? []) {
    const p = s.properties;
    console.log(
      `  gid=${String(p.sheetId).padEnd(12)} ${JSON.stringify(p.title).padEnd(26)} ${p.gridProperties?.rowCount}x${p.gridProperties?.columnCount}`,
    );
  }
}

/** Every placement in a month tab as {week,pub,date,dow,location,role,shift,person}. */
export async function extractTab(tab, roleFilter = "") {
  const tabMonth = MONTHS[tab.trim().toLowerCase()];
  if (!tabMonth) throw new Error(`cannot resolve a month from tab "${tab}"`);

  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1:BE500`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const grid = data.values ?? [];
  const cell = (r, c) => String(grid[r]?.[c] ?? "").replace(/\s+/g, " ").trim();

  const blocks = [];
  grid.forEach((_, i) => {
    if (/^WEEK\s*\d/i.test(cell(i, 1))) blocks.push(i);
  });
  if (!blocks.length) return [];

  // Day numbers ascend across the tab and wrap at month boundaries. Week 1 can
  // start in the previous month, so seed from it and advance on every wrap.
  let curMonth = tabMonth;
  let curYear = YEAR;
  let prevDom = 0;
  for (let c = 3; c < 48; c++) {
    const dom = parseInt(cell(blocks[0] + 1, c), 10);
    if (!Number.isFinite(dom)) continue;
    if (dom > 20) {
      curMonth = tabMonth - 1;
      if (curMonth < 1) {
        curMonth = 12;
        curYear = YEAR - 1;
      }
    }
    break;
  }

  const needle = roleFilter.toLowerCase();
  const out = [];

  for (let b = 0; b < blocks.length; b++) {
    const head = blocks[b];
    const end = b + 1 < blocks.length ? blocks[b + 1] : grid.length;
    const pub = cell(head, 2);

    const days = [];
    for (let c = 3; c < 48; c++) {
      const dow = cell(head, c).toUpperCase();
      if (!/^(SUN|MON|TUES|WEDNES|THURS|FRI|SATUR)DAY$/.test(dow)) continue;
      const dom = parseInt(cell(head + 1, c), 10);
      if (!Number.isFinite(dom)) continue;
      if (dom < prevDom) {
        curMonth += 1;
        if (curMonth > 12) {
          curMonth = 1;
          curYear += 1;
        }
      }
      prevDom = dom;
      days.push({
        col: c,
        dow,
        date: `${curYear}-${String(curMonth).padStart(2, "0")}-${String(dom).padStart(2, "0")}`,
      });
    }

    // Rows between the location header and the block's second "Role | Shift"
    // header are day notes ("Heavy VE day/ 2/hr", "Surgery Day", "LABOR DAY").
    // Staffing starts after that header.
    let firstStaffRow = head + 3;
    for (let r = head + 3; r < end; r++) {
      if (/^role$/i.test(cell(r, 1)) && /^shift$/i.test(cell(r, 2))) {
        firstStaffRow = r + 1;
        break;
      }
    }

    for (let r = firstStaffRow; r < end; r++) {
      const role = cell(r, 1);
      if (!role || (needle && !role.toLowerCase().includes(needle))) continue;
      if (/^WEEK\s*\d/i.test(role) || role === "Role") continue;
      const shift = cell(r, 2);

      for (let d = 0; d < days.length; d++) {
        const day = days[d];
        const limit =
          (d + 1 < days.length ? days[d + 1].col : day.col + 7) - day.col - 1;
        for (let off = 0; off <= limit; off++) {
          const loc = cell(head + 2, day.col + off);
          if (!SHEET_LOCATIONS[loc.toUpperCase()]) continue;
          const person = cell(r, day.col + off);
          if (!person) continue;
          out.push({
            week: cell(head, 1),
            pub,
            date: day.date,
            dow: day.dow,
            location: loc.toUpperCase(),
            role,
            shift,
            person,
          });
        }
      }
    }
  }
  return out;
}

const [cmd, tab, roleFilter] = process.argv.slice(2);

if (cmd === "tabs") {
  await listTabs();
} else if (cmd === "extract") {
  const rows = await extractTab(tab, roleFilter ?? "");
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  console.log(
    `${tab}: ${rows.length} placements, ${dates.length} days (${dates[0]}..${dates.at(-1)})`,
  );
  fs.mkdirSync(path.join(ROOT, ".data"), { recursive: true });
  const outPath = path.join(ROOT, ".data", `sheet_${tab}_${roleFilter || "all"}.json`);
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`wrote ${path.relative(ROOT, outPath)}`);
} else {
  console.log(
    "usage:\n  read_schedule_sheet.mjs tabs\n  read_schedule_sheet.mjs extract <Tab> [roleSubstring]",
  );
}
