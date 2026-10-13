import { describe, expect, it } from "vitest";
import { buildAcknowledgements, formatAckTimestamp } from "./acknowledgements";

const CURRENT = "2026-10-13";

describe("formatAckTimestamp", () => {
  it("shows date and time in Pacific time", () => {
    expect(formatAckTimestamp("2026-10-13T21:31:00Z")).toBe("Oct 13, 2026 at 2:31 PM PDT");
    expect(formatAckTimestamp("2026-12-01T17:05:00Z")).toBe("Dec 1, 2026 at 9:05 AM PST");
  });

  it("keeps the Pacific calendar date for late-evening UTC-next-day times", () => {
    expect(formatAckTimestamp("2026-10-14T03:15:00Z")).toBe("Oct 13, 2026 at 8:15 PM PDT");
  });

  it("returns null for missing or invalid input", () => {
    expect(formatAckTimestamp(null)).toBeNull();
    expect(formatAckTimestamp("")).toBeNull();
    expect(formatAckTimestamp("not a date")).toBeNull();
  });
});

describe("buildAcknowledgements — text opt-in", () => {
  const notice = { noticeAcks: [], currentNoticeVersion: CURRENT };

  it("records the opt-in date, time and source", () => {
    const [sms] = buildAcknowledgements({
      ...notice,
      sms: {
        consent: { source: "Opted in at greendogops.com/texts", consented_at: "2026-10-13T21:31:00Z" },
        optOut: null,
      },
    });
    expect(sms).toMatchObject({
      key: "sms_opt_in",
      state: "done",
      status: "Opted in",
      at: "Oct 13, 2026 at 2:31 PM PDT",
      detail: "Opted in at greendogops.com/texts",
    });
  });

  it("shows not opted in as voluntary, not as a missing requirement", () => {
    const [sms] = buildAcknowledgements({ ...notice, sms: { consent: null, optOut: null } });
    expect(sms.state).toBe("none");
    expect(sms.status).toBe("Not opted in");
    expect(sms.at).toBeNull();
    expect(sms.detail).toMatch(/voluntary/i);
  });

  it("a STOP reply overrides an opt-in and keeps the opt-in time as history", () => {
    const [sms] = buildAcknowledgements({
      ...notice,
      sms: {
        consent: { source: "Opted in at greendogops.com/texts", consented_at: "2026-10-14T16:00:00Z" },
        optOut: { opted_out_at: "2026-10-13T16:00:00Z" },
      },
    });
    expect(sms.state).toBe("attention");
    expect(sms.status).toBe("Opted out (replied STOP)");
    expect(sms.at).toBe("Oct 13, 2026 at 9:00 AM PDT");
    expect(sms.detail).toBe("Had opted in Oct 14, 2026 at 9:00 AM PDT");
  });

  it("omits the text row when the viewer may not see texting data", () => {
    const rows = buildAcknowledgements(notice);
    expect(rows.map((r) => r.key)).toEqual(["time_clock_notice"]);
  });
});

describe("buildAcknowledgements — time clock notice", () => {
  it("marks the current version as Read with its date and time", () => {
    const [ack] = buildAcknowledgements({
      noticeAcks: [
        { notice_version: "2026-01-01", acknowledged_at: "2026-01-02T18:00:00Z" },
        { notice_version: CURRENT, acknowledged_at: "2026-10-13T15:45:00Z" },
      ],
      currentNoticeVersion: CURRENT,
    });
    expect(ack).toMatchObject({
      key: "time_clock_notice",
      state: "done",
      status: "Read",
      at: "Oct 13, 2026 at 8:45 AM PDT",
      detail: `Version ${CURRENT}`,
    });
  });

  it("flags an outdated acknowledgement with the most recent earlier read", () => {
    const [ack] = buildAcknowledgements({
      noticeAcks: [
        { notice_version: "2026-01-01", acknowledged_at: "2026-01-02T18:00:00Z" },
        { notice_version: "2026-06-01", acknowledged_at: "2026-06-03T18:00:00Z" },
      ],
      currentNoticeVersion: CURRENT,
    });
    expect(ack.state).toBe("attention");
    expect(ack.status).toBe("Read an earlier version");
    expect(ack.at).toBe("Jun 3, 2026 at 11:00 AM PDT");
    expect(ack.detail).toContain("2026-06-01");
  });

  it("shows not yet read when nothing is on file", () => {
    const [ack] = buildAcknowledgements({ noticeAcks: [], currentNoticeVersion: CURRENT });
    expect(ack).toMatchObject({ state: "none", status: "Not yet read", at: null });
  });
});
