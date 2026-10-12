import { describe, expect, it } from "vitest";
import { EVENT_REGISTRY, EVENT_TYPES } from "./registry";
import { SAMPLE_PAYLOADS } from "./samples";

describe("event registry", () => {
  it("has unique, well-formed event types", () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    for (const t of EVENT_TYPES) expect(t).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it("gives every routed event a template and a sample", () => {
    for (const def of EVENT_REGISTRY.values()) {
      if (def.direct) continue;
      expect(def.render, def.type).toBeTypeOf("function");
      expect(SAMPLE_PAYLOADS[def.type], def.type).toBeDefined();
    }
  });

  it("renders every sample for subjects, others and channels without blanks", () => {
    for (const def of EVENT_REGISTRY.values()) {
      if (!def.render) continue;
      for (const ctx of [
        { isSubject: true, personId: "p1", isChannel: false },
        { isSubject: false, personId: "p2", isChannel: false },
        { isSubject: false, personId: null, isChannel: true },
      ]) {
        const msg = def.render(SAMPLE_PAYLOADS[def.type] ?? {}, ctx);
        expect(msg.title.trim().length, def.type).toBeGreaterThan(0);
        expect(msg.title.length, def.type).toBeLessThanOrEqual(200);
        expect(JSON.stringify(msg), def.type).not.toMatch(/undefined|\[object Object\]/);
        for (const f of msg.fields ?? []) expect(f.value.trim(), `${def.type} ${f.label}`).not.toBe("");
      }
    }
  });

  it("only offers approve/deny where an edit permission gates it", () => {
    for (const def of EVENT_REGISTRY.values()) {
      if (def.actions?.some((a) => a.startsWith("pto."))) expect(def.actionModule, def.type).toBeTruthy();
    }
  });

  it("keeps personal time-off and attendance events restricted", () => {
    for (const t of ["pto.requested", "pto.approved", "pto.denied", "pto.modified", "attendance.missed_shift", "schedule.shift_changed"]) {
      expect(EVENT_REGISTRY.get(t)?.sensitivity, t).toBe("module");
    }
  });

  it("never posts PTO decisions to a channel", () => {
    expect(EVENT_REGISTRY.get("pto.approved")?.allowChannel).toBe(false);
    expect(EVENT_REGISTRY.get("pto.denied")?.allowChannel).toBe(false);
  });
});
