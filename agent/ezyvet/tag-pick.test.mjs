import { describe, expect, it } from "vitest";
import { pickTagSuggestion } from "./tag-pick.mjs";

// Real suggestions ezyVet returned for "ap" on 2026-10-15.
const AP_SUGGESTIONS = [
  { id: "0", title: "", group: null },
  { id: "5140", title: "AP", group: "General" },
  { id: "6364", title: "ap", group: "MyPetClient (Exclude from reminders for now)" },
  { id: "4944", title: "Alert", group: "General" },
];

describe("pickTagSuggestion", () => {
  it("picks the Advanced Procedure tag by its ezyVet id", () => {
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "ap", tagId: 5140 })?.id).toBe("5140");
  });

  it("picks AP in General, not the MyPetClient 'ap', by group", () => {
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "AP", group: "General" })?.id).toBe("5140");
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "ap", group: "General" })?.id).toBe("5140");
  });

  it("lets an exact-case title win, but refuses a case-insensitive tie", () => {
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "AP" })?.id).toBe("5140");
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "Ap" })).toBeNull();
  });

  it("returns null for an id or label that is not offered", () => {
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "ap", tagId: 9999 })).toBeNull();
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "CODE *101*", group: "General" })).toBeNull();
  });

  it("never picks the blank placeholder row", () => {
    expect(pickTagSuggestion(AP_SUGGESTIONS, { label: "" })).toBeNull();
  });

  it("ignores zero-width spaces and padding in ezyVet titles", () => {
    const items = [{ id: "6214", title: "VIP ", group: "General" }, { id: "5217", title: "\u200b5 Star FB Review", group: "General" }];
    expect(pickTagSuggestion(items, { label: "VIP", group: "General" })?.id).toBe("6214");
    expect(pickTagSuggestion(items, { label: "5 Star FB Review", group: "General" })?.id).toBe("5217");
  });
});
