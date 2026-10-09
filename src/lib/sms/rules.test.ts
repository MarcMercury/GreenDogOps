import { describe, expect, it } from "vitest";
import {
  OPT_OUT_FOOTER,
  blockReason,
  normalizeStatus,
  shouldApplyStatus,
  statusesReplaceableBy,
  type SmsEnv,
  type SmsTargetFacts,
  classifyKeyword,
  composeOutbound,
  e164ToHouseFormat,
  hasSmsConsent,
  isQuietHours,
  isTextableStatus,
  parseTestNumbers,
  passesGoLiveGate,
  toE164,
  validateSmsBody,
} from "./rules";
import { isValidTwilioSignature, twilioSignature } from "./signature";

describe("toE164", () => {
  it("normalises US numbers in any common format", () => {
    expect(toE164("(310) 555-1234")).toBe("+13105551234");
    expect(toE164("310.555.1234")).toBe("+13105551234");
    expect(toE164("+1 310 555 1234")).toBe("+13105551234");
    expect(toE164("1-310-555-1234")).toBe("+13105551234");
    expect(toE164("(310) 555-1234 x22")).toBe("+13105551234");
  });

  it("rejects blanks, short numbers, invalid NANP and international numbers", () => {
    expect(toE164(null)).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164("555-1234")).toBeNull();
    expect(toE164("(110) 555-1234")).toBeNull();
    expect(toE164("(310) 155-1234")).toBeNull();
    expect(toE164("+44 20 7946 0958")).toBeNull();
  });

  it("round-trips to the house format used on person.phone_mobile", () => {
    expect(e164ToHouseFormat("+13105551234")).toBe("(310) 555-1234");
    expect(e164ToHouseFormat("+442079460958")).toBeNull();
  });
});

describe("classifyKeyword", () => {
  it("recognises carrier keywords as the whole message, any case", () => {
    expect(classifyKeyword("STOP")).toBe("stop");
    expect(classifyKeyword(" stop. ")).toBe("stop");
    expect(classifyKeyword("Unsubscribe")).toBe("stop");
    expect(classifyKeyword("start")).toBe("start");
    expect(classifyKeyword("HELP")).toBe("help");
  });

  it("ignores keywords inside a normal reply", () => {
    expect(classifyKeyword("Please don't stop the interview")).toBeNull();
    expect(classifyKeyword("Yes I can come at 3")).toBeNull();
    expect(classifyKeyword("")).toBeNull();
  });
});

describe("isQuietHours", () => {
  // October: PDT (UTC-7). December: PST (UTC-8).
  it("allows 8:00 AM through 8:59 PM", () => {
    expect(isQuietHours(new Date("2026-10-13T15:00:00Z"))).toBe(false); // 8:00 AM PDT
    expect(isQuietHours(new Date("2026-10-14T03:59:00Z"))).toBe(false); // 8:59 PM PDT
    expect(isQuietHours(new Date("2026-12-01T16:00:00Z"))).toBe(false); // 8:00 AM PST
  });

  it("blocks 9:00 PM through 7:59 AM", () => {
    expect(isQuietHours(new Date("2026-10-14T04:00:00Z"))).toBe(true); // 9:00 PM PDT
    expect(isQuietHours(new Date("2026-10-13T14:59:00Z"))).toBe(true); // 7:59 AM PDT
    expect(isQuietHours(new Date("2026-12-01T15:30:00Z"))).toBe(true); // 7:30 AM PST
  });
});

describe("who can be texted", () => {
  it("allows candidates, employees and contractors, never former employees", () => {
    expect(isTextableStatus("applicant")).toBe(true);
    expect(isTextableStatus("prospect")).toBe(true);
    expect(isTextableStatus("employee")).toBe(true);
    expect(isTextableStatus("contractor")).toBe(true);
    expect(isTextableStatus("former")).toBe(false);
    expect(isTextableStatus(null)).toBe(false);
  });

  it("needs the application acknowledgement or recorded consent", () => {
    expect(hasSmsConsent({ status: "applicant", applicationAnswer: "Yes", consentRecorded: false })).toBe(true);
    expect(hasSmsConsent({ status: "applicant", applicationAnswer: undefined, consentRecorded: true })).toBe(true);
    expect(hasSmsConsent({ status: "applicant", applicationAnswer: undefined, consentRecorded: false })).toBe(false);
    expect(hasSmsConsent({ status: "applicant", applicationAnswer: "No", consentRecorded: false })).toBe(false);
    expect(hasSmsConsent({ status: "applicant", applicationAnswer: ["Yes"], consentRecorded: false })).toBe(false);
  });

  it("doesn't carry application consent over to employees", () => {
    // The box says "texts … about my application" — after hire HR must record consent.
    expect(hasSmsConsent({ status: "employee", applicationAnswer: "Yes", consentRecorded: false })).toBe(false);
    expect(hasSmsConsent({ status: "contractor", applicationAnswer: "Yes", consentRecorded: false })).toBe(false);
    expect(hasSmsConsent({ status: "employee", applicationAnswer: "Yes", consentRecorded: true })).toBe(true);
  });
});

describe("go-live gate", () => {
  const testNumbers = parseTestNumbers("(310) 555-1234; +1 818 555 0000, junk");

  it("parses the test-number list to E.164 and drops junk", () => {
    expect([...testNumbers]).toEqual(["+13105551234", "+18185550000"]);
  });

  it("only texts test numbers until SMS_LIVE is on", () => {
    expect(passesGoLiveGate("+13105551234", { live: false, testNumbers })).toBe(true);
    expect(passesGoLiveGate("+12135550000", { live: false, testNumbers })).toBe(false);
    expect(passesGoLiveGate("+12135550000", { live: true, testNumbers })).toBe(true);
  });
});

describe("composeOutbound", () => {
  it("brands the text and adds the opt-out line to the first text only", () => {
    expect(composeOutbound("  See you at 3!  ", { firstToNumber: true })).toBe(`Green Dog: See you at 3!\n${OPT_OUT_FOOTER}`);
    expect(composeOutbound("See you at 3!", { firstToNumber: false })).toBe("Green Dog: See you at 3!");
    expect(composeOutbound("Green Dog here — see you at 3", { firstToNumber: false })).toBe("Green Dog here — see you at 3");
  });

  it("validates length and emptiness", () => {
    expect(validateSmsBody("   ")).toBe("Write a message first.");
    expect(validateSmsBody("x".repeat(641))).toMatch(/under 640/);
    expect(validateSmsBody("Hi")).toBeNull();
  });
});

describe("blockReason", () => {
  const daytime = new Date("2026-10-13T18:00:00Z"); // 11 AM PDT
  const night = new Date("2026-10-14T05:00:00Z"); // 10 PM PDT
  const live: SmsEnv = { configured: true, live: true, testNumbers: new Set() };
  const ok: SmsTargetFacts = {
    status: "applicant",
    name: "Sam",
    phoneRaw: "(310) 555-1234",
    phone: "+13105551234",
    hasConsent: true,
    optedOut: false,
  };

  it("allows a consented, opted-in candidate during the day", () => {
    expect(blockReason(ok, live, daytime)).toBeNull();
  });

  it("blocks each failed rule with a specific reason", () => {
    expect(blockReason(ok, { ...live, configured: false }, daytime)).toMatch(/isn't set up/);
    expect(blockReason({ ...ok, status: "former" }, live, daytime)).toMatch(/Former employees/);
    expect(blockReason({ ...ok, phoneRaw: null, phone: null }, live, daytime)).toMatch(/No mobile number/);
    expect(blockReason({ ...ok, phoneRaw: "555-1234", phone: null }, live, daytime)).toMatch(/isn't a US mobile/);
    expect(blockReason({ ...ok, optedOut: true }, live, daytime)).toMatch(/replied STOP/);
    expect(blockReason({ ...ok, hasConsent: false }, live, daytime)).toMatch(/No texting consent/);
    expect(blockReason(ok, { ...live, live: false }, daytime)).toMatch(/test mode/);
    expect(blockReason(ok, live, night)).toMatch(/8 AM and 9 PM Pacific/);
  });

  it("lets test numbers through in test mode", () => {
    expect(blockReason(ok, { configured: true, live: false, testNumbers: new Set(["+13105551234"]) }, daytime)).toBeNull();
  });

  it("puts opt-out ahead of consent so a STOP is never overridden", () => {
    expect(blockReason({ ...ok, optedOut: true, hasConsent: true }, live, daytime)).toMatch(/replied STOP/);
  });
});

describe("normalizeStatus", () => {
  it("maps Twilio statuses onto ours", () => {
    expect(normalizeStatus("delivered")).toBe("delivered");
    expect(normalizeStatus("accepted")).toBe("queued");
    expect(normalizeStatus("read")).toBe("delivered");
    expect(normalizeStatus("canceled")).toBe("failed");
    expect(normalizeStatus(undefined)).toBe("queued");
  });
});

describe("shouldApplyStatus", () => {
  it("moves forward and ignores late, older callbacks", () => {
    expect(shouldApplyStatus("queued", "sent")).toBe(true);
    expect(shouldApplyStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyStatus("delivered", "sent")).toBe(false);
    expect(shouldApplyStatus("delivered", "delivered")).toBe(false);
    expect(shouldApplyStatus("sent", "undelivered")).toBe(true);
  });

  it("lists the stored statuses a callback may overwrite", () => {
    expect(statusesReplaceableBy("delivered").sort()).toEqual(["queued", "sending", "sent"]);
    expect(shouldApplyStatus("delivered", "undelivered")).toBe(false);
    expect(statusesReplaceableBy("sent").sort()).toEqual(["queued", "sending"]);
    expect(statusesReplaceableBy("queued")).toEqual([]);
  });
});

describe("Twilio signature", () => {
  // Example from Twilio's request-validation docs.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };

  it("matches Twilio's documented example", () => {
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("rejects missing, wrong or tampered signatures", () => {
    expect(isValidTwilioSignature("12345", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    expect(isValidTwilioSignature("12345", url, params, null)).toBe(false);
    expect(isValidTwilioSignature("wrong", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(isValidTwilioSignature("12345", url, { ...params, Digits: "9999" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
  });
});
