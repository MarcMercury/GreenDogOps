import { describe, expect, it } from "vitest";
import { APP_ROLES } from "../auth/permissions";
import { smartScopeFor } from "./smart-scope";

describe("smartScopeFor", () => {
  it("never lets any role query other people's tasks, notifications or reminders", () => {
    for (const role of APP_ROLES) {
      const blocked = smartScopeFor(role).blockedTables;
      for (const t of ["ops_task", "user_notification", "notification_delivery", "reminder_rule", "reminder_ack", "credential"]) {
        expect(blocked, `${role} / ${t}`).toContain(t);
      }
    }
  });

  it("keeps compensation for Owner/Admin/Executive only", () => {
    expect(smartScopeFor("owner").canViewCompensation).toBe(true);
    expect(smartScopeFor("executive").canViewCompensation).toBe(true);
    expect(smartScopeFor("manager").canViewCompensation).toBe(false);
    expect(smartScopeFor("schedule_admin").blockedTables).toContain("person_license");
  });
});
