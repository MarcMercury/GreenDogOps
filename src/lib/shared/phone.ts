/**
 * Canonical phone-number formatting for the whole app.
 *
 * House format for US / Canada (NANP) numbers is `(###) ###-####` — the `+1`
 * country code is always dropped. Numbers that resolve to a country outside the
 * NANP keep an explicit `+<code>` prefix so they stay dialable. Anything we
 * cannot confidently parse is passed through untouched rather than mangled.
 */

/** ITU-T E.164 country calling codes, excluding `1` (US / Canada / NANP). */
const CALLING_CODES: ReadonlySet<string> = new Set([
  "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
  "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57",
  "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90",
  "91", "92", "93", "94", "95", "98",
  "211", "212", "213", "216", "218", "220", "221", "222", "223", "224", "225",
  "226", "227", "228", "229", "230", "231", "232", "233", "234", "235", "236",
  "237", "238", "239", "240", "241", "242", "243", "244", "245", "246", "247",
  "248", "249", "250", "251", "252", "253", "254", "255", "256", "257", "258",
  "260", "261", "262", "263", "264", "265", "266", "267", "268", "269", "290",
  "291", "297", "298", "299",
  "350", "351", "352", "353", "354", "355", "356", "357", "358", "359", "370",
  "371", "372", "373", "374", "375", "376", "377", "378", "379", "380", "381",
  "382", "383", "385", "386", "387", "389",
  "420", "421", "423",
  "500", "501", "502", "503", "504", "505", "506", "507", "508", "509", "590",
  "591", "592", "593", "594", "595", "596", "597", "598", "599",
  "670", "672", "673", "674", "675", "676", "677", "678", "679", "680", "681",
  "682", "683", "685", "686", "687", "688", "689", "690", "691", "692",
  "850", "852", "853", "855", "856", "880", "886",
  "960", "961", "962", "963", "964", "965", "966", "967", "968", "970", "971",
  "972", "973", "974", "975", "976", "977", "992", "993", "994", "995", "996",
  "998",
]);

/** Trailing "ext 12" / "x12" style suffixes, kept verbatim after formatting. */
function splitExtension(value: string): { base: string; ext: string | null } {
  const m = value.match(/[\s,.;/-]*(?:ext|extension|x)\.?\s*(\d{1,6})\s*$/i);
  if (!m || m.index === undefined || m.index === 0) return { base: value, ext: null };
  return { base: value.slice(0, m.index).trim(), ext: m[1] };
}

function formatNanp(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Groups a national number into readable 3-digit blocks, right-aligned. */
function groupNational(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  // A lone leading digit reads better merged into the next block.
  if (groups.length > 1 && groups[0].length === 1) {
    groups[1] = groups[0] + groups[1];
    groups.shift();
  }
  return groups.join(" ");
}

/** Longest-first match of a non-NANP country calling code. */
function matchCallingCode(digits: string): string | null {
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (CALLING_CODES.has(cc)) return cc;
  }
  return null;
}

function formatInternational(cc: string, national: string): string | null {
  if (national.length < 4) return null;
  return `+${cc} ${groupNational(national)}`;
}

/**
 * Normalize any phone-ish string to the house format.
 *
 * Returns `null` for blank input, and returns the original (trimmed) string
 * when the value cannot be recognized as a phone number.
 */
export function formatPhoneNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const { base, ext } = splitExtension(trimmed);
  const withExt = (formatted: string) => (ext ? `${formatted} x${ext}` : formatted);

  const cleaned = base.replace(/[^\d+]/g, "");
  if (!cleaned) return trimmed;

  let digits = cleaned.replace(/\D/g, "");
  // "+", "011" and "00" all mean "an explicit country code follows".
  let explicitCountryCode = cleaned.startsWith("+");
  if (!explicitCountryCode && /^(?:011|00)\d/.test(digits)) {
    digits = digits.replace(/^(?:011|00)/, "");
    explicitCountryCode = true;
  }

  if (digits.length === 10) return withExt(formatNanp(digits));
  if (digits.length === 11 && digits.startsWith("1")) return withExt(formatNanp(digits.slice(1)));

  if (explicitCountryCode || digits.length > 11) {
    const cc = matchCallingCode(digits);
    const intl = cc ? formatInternational(cc, digits.slice(cc.length)) : null;
    if (intl) return withExt(intl);
  }

  return trimmed;
}

/**
 * Progressive formatting applied on every keystroke. Only shapes plain NANP
 * entry; international/partial values are left alone until blur, where
 * {@link formatPhoneNumber} finishes the job.
 */
export function formatPhoneInput(raw: string): string {
  if (/[a-z]/i.test(raw) || raw.trimStart().startsWith("+")) return raw;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length > 10) return raw;

  if (national.length <= 3) return national;
  if (national.length <= 6) return `(${national.slice(0, 3)}) ${national.slice(3)}`;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
