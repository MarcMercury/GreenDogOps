import { describe, expect, it } from "vitest";
import type { AppRole, AppUser } from "@/lib/auth/permissions";
import { resolveAudience, stillAllowed, type DirectoryPerson } from "./audience";
import { EMPTY_AUDIENCE, type Audience } from "./types";

function login(id: string, role: AppRole, module_access: Record<string, boolean> = {}): AppUser {
  return {
    id,
    email: `${id}@example.com`,
    full_name: id,
    title: null,
    role,
    is_active: true,
    module_access,
    notes: null,
    person_id: null,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

function person(id: string, opts: Partial<DirectoryPerson> = {}): DirectoryPerson {
  return { personId: id, name: id, locationId: null, departmentIds: [], slackUserId: `U${id.toUpperCase()}`, login: null, ...opts };
}

const aud = (a: Partial<Audience>): Audience => ({ ...EMPTY_AUDIENCE, ...a });

const directory: DirectoryPerson[] = [
  person("staff1"), // no login
  person("sched1", { login: login("u-sched1", "schedule_admin"), locationId: "aetna" }),
  person("sched2", { login: login("u-sched2", "schedule_admin"), locationId: "venice" }),
  person("mgr1", { login: login("u-mgr1", "manager"), locationId: "aetna" }),
  person("mkt1", { login: login("u-mkt1", "marketing_admin") }),
  person("viewer", { login: login("u-viewer", "staff"), departmentIds: ["dept-tech"] }),
  // A manager whose Scheduling access was switched off by an admin.
  person("noSched", { login: login("u-noSched", "manager", { schedule: false }) }),
];

const ids = (r: { recipients: { personId: string }[] }) => r.recipients.map((x) => x.personId).sort();

describe("resolveAudience", () => {
  it("routes by role from current Ops access", () => {
    const r = resolveAudience({
      audience: aud({ roles: ["schedule_admin"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    expect(ids(r)).toEqual(["sched1", "sched2"]);
  });

  it("follows role changes — a new schedule admin starts receiving, a former one stops", () => {
    const changed = directory.map((p) =>
      p.personId === "sched2"
        ? { ...p, login: login("u-sched2", "staff") }
        : p.personId === "viewer"
          ? { ...p, login: login("u-viewer", "schedule_admin") }
          : p,
    );
    const r = resolveAudience({
      audience: aud({ roles: ["schedule_admin"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory: changed,
    });
    expect(ids(r)).toEqual(["sched1", "viewer"]);
  });

  it("includes the people an event is about, even without a login", () => {
    const r = resolveAudience({
      audience: aud({ subjects: true }),
      sensitivity: "module",
      module: "schedule",
      event: { subjectPersonIds: ["staff1"] },
      directory,
    });
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0]).toMatchObject({ personId: "staff1", isSubject: true, userId: null });
  });

  it("drops people who are no longer active (not in the directory)", () => {
    const r = resolveAudience({
      audience: aud({ subjects: true }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: ["former"] },
      directory,
    });
    expect(r.recipients).toHaveLength(0);
    expect(r.excluded[0].reason).toMatch(/not an active/i);
  });

  it("restricted content never reaches non-subjects without module access", () => {
    const r = resolveAudience({
      audience: aud({ personIds: ["staff1", "noSched", "mgr1"] }),
      sensitivity: "module",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    expect(ids(r)).toEqual(["mgr1"]);
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.personId, e.reason]));
    expect(reasons.staff1).toMatch(/no ops login/i);
    expect(reasons.noSched).toMatch(/scheduling/i);
  });

  it("general content can go to anyone picked, with or without a login", () => {
    const r = resolveAudience({
      audience: aud({ personIds: ["staff1", "noSched"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    expect(ids(r)).toEqual(["noSched", "staff1"]);
  });

  it("routes to module editors, honouring per-user overrides", () => {
    const r = resolveAudience({
      audience: aud({ editorsOf: ["schedule"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    // marketing_admin can view Scheduling but not edit it; noSched has it switched off.
    expect(ids(r)).toEqual(["mgr1", "sched1", "sched2"]);
  });

  it("routes by scheduling department", () => {
    const r = resolveAudience({
      audience: aud({ departmentIds: ["dept-tech"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    expect(ids(r)).toEqual(["viewer"]);
  });

  it("limits role recipients to the event's location when asked", () => {
    const r = resolveAudience({
      audience: aud({ roles: ["schedule_admin", "manager"], sameLocation: true }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [], locationId: "aetna" },
      directory,
    });
    expect(ids(r)).toEqual(["mgr1", "sched1"]);
  });

  it("never notifies the person who caused the event", () => {
    const r = resolveAudience({
      audience: aud({ roles: ["schedule_admin"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [], actorUserId: "u-sched1" },
      directory,
    });
    expect(ids(r)).toEqual(["sched2"]);
  });

  it("only offers approve buttons to people who can edit the action module", () => {
    const r = resolveAudience({
      audience: aud({ roles: ["schedule_admin", "marketing_admin"] }),
      sensitivity: "general",
      module: "schedule",
      actionModule: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    const canAct = Object.fromEntries(r.recipients.map((x) => [x.personId, x.canAct]));
    expect(canAct).toEqual({ mkt1: false, sched1: true, sched2: true });
  });

  it("reports whether each recipient can open the event's module", () => {
    const r = resolveAudience({
      audience: aud({ personIds: ["staff1", "noSched", "mgr1"] }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [] },
      directory,
    });
    const access = Object.fromEntries(r.recipients.map((x) => [x.personId, x.moduleAccess]));
    expect(access).toEqual({ mgr1: true, noSched: false, staff1: false });
  });

  it("includes eligible candidates when asked", () => {
    const r = resolveAudience({
      audience: aud({ candidates: true }),
      sensitivity: "general",
      module: "schedule",
      event: { subjectPersonIds: [], candidatePersonIds: ["staff1"] },
      directory,
    });
    expect(r.recipients[0]).toMatchObject({ personId: "staff1", reasons: ["candidate"] });
  });
});

describe("stillAllowed", () => {
  it("re-checks module access at send time", () => {
    expect(stillAllowed(null, null)).toBe(true);
    expect(stillAllowed(null, "schedule")).toBe(false);
    expect(stillAllowed(login("a", "manager"), "schedule")).toBe(true);
    expect(stillAllowed(login("a", "manager", { schedule: false }), "schedule")).toBe(false);
    expect(stillAllowed({ ...login("a", "admin"), is_active: false }, "schedule")).toBe(false);
  });
});
