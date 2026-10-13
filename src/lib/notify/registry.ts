// ---------------------------------------------------------------------------
// Notification event registry — the one list of everything Ops can notify.
//
// To add Slack/in-app notifications to a module:
//   1. Add an EventDefinition here (label, module, sensitivity, default
//      routing, render()).
//   2. Call emitEvent() (src/lib/notify/engine.ts) from the module's server
//      code after the change succeeds, with the event's subjects and payload.
// Routing is then editable in Admin ▸ Notifications without code changes.
//
// Pure (no server imports): Admin UI and tests import it.
//
// Never put compensation, HR-file content, candidate personal details or
// clinical data in a payload or render() output — DMs leave the app.
// ---------------------------------------------------------------------------

import type { ModuleKey } from "../auth/permissions";
import { clip, str, strList, weekLabel } from "./format";
import {
  EMPTY_AUDIENCE,
  type Audience,
  type NotifyActionId,
  type RenderContext,
  type RenderedMessage,
  type RuleConfig,
  type Sensitivity,
} from "./types";

export type NotifySeverity = "info" | "action" | "warning";

export interface EventDefinition {
  type: string;
  group: string;
  label: string;
  description: string;
  /** Module the event belongs to; non-subjects need access to it when sensitivity is "module". */
  module: ModuleKey;
  sensitivity: Sensitivity;
  /** Recipient is chosen by the caller (publishNotification); only on/off, DM and inbox are configurable. */
  direct?: boolean;
  /** May also be posted to a Slack channel. */
  allowChannel: boolean;
  /** Buttons on the Slack message. */
  actions?: NotifyActionId[];
  /** Module a recipient must be able to edit to use approve/deny buttons. */
  actionModule?: ModuleKey;
  /** The engine can tell whether the event still needs action (escalations). */
  escalatable?: boolean;
  /**
   * General event whose full details (e.g. who is out and why) are only for
   * people who can open `module`; others get an anonymised render, and a
   * detailed copy is re-checked against `module` at send time.
   */
  detailsNeedModule?: boolean;
  severity: NotifySeverity;
  defaults: RuleConfig;
  render?: (payload: Record<string, unknown>, ctx: RenderContext) => RenderedMessage;
  /** Key of the record a sent card is about, so it can be updated in place. */
  messageKey?: (subjectId: string | null) => string | null;
  /** Pending DMs with the same key for the same person are merged. */
  coalesceKey?: (payload: Record<string, unknown>) => string | null;
}

function audience(partial: Partial<Audience>): Audience {
  return { ...EMPTY_AUDIENCE, ...partial };
}

function rule(partial: Partial<Omit<RuleConfig, "audience">> & { audience?: Partial<Audience> }): RuleConfig {
  return {
    enabled: true,
    deliverDm: true,
    deliverInbox: true,
    channelId: null,
    channelName: null,
    priority: "normal",
    batchMinutes: 0,
    escalateAfterHours: null,
    escalateRoles: [],
    ...partial,
    audience: audience(partial.audience ?? {}),
  };
}

const scheduleHref = (p: Record<string, unknown>) =>
  str(p, "weekId") ? `/schedule?week=${str(p, "weekId")}` : "/schedule";

/** Event card fields shared by the marketing templates. */
function marketingFields(p: Record<string, unknown>) {
  const fields = [
    { label: "When", value: [str(p, "dates"), str(p, "time")].filter(Boolean).join(" · ") },
    { label: "Where", value: str(p, "location") },
    { label: "Clinic", value: str(p, "clinic") },
    { label: "Staff", value: strList(p, "staffNames").join(", ") },
  ];
  return fields.filter((f) => f.value);
}

const DEFINITIONS: EventDefinition[] = [
  // ------------------------------------------------------------------ Scheduling
  {
    type: "schedule.published",
    group: "Scheduling",
    label: "Schedule published",
    description:
      "A week's schedule is published. Each scheduled employee gets their own shifts only.",
    module: "schedule",
    sensitivity: "general",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => {
      const week = weekLabel(str(p, "weekStart"));
      if (ctx.isSubject && ctx.personId) {
        const shifts = (p.shifts as Record<string, string[]> | undefined)?.[ctx.personId] ?? [];
        return {
          emoji: "📅",
          title: `Your schedule for the ${week} is ready`,
          lines: shifts.length ? shifts : ["No shifts scheduled for you this week."],
          href: scheduleHref(p),
          linkLabel: "View the schedule",
        };
      }
      return {
        emoji: "📅",
        title: `Schedule published for the ${week}`,
        body: `${str(p, "peopleCount") || "0"} people scheduled.`,
        href: scheduleHref(p),
        linkLabel: "View the schedule",
      };
    },
  },
  {
    type: "schedule.shift_changed",
    group: "Scheduling",
    label: "Shift changed after publishing",
    description:
      "Someone's shift is added, moved or removed on a published week. Changes made within the batching window are sent as one message with their current shifts.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { subjects: true }, batchMinutes: 10 }),
    // Per affected employee (the delivery row is already per recipient), so a
    // manager watching several people gets one update per person, not one merged.
    coalesceKey: (p) => `shift:${str(p, "weekId")}:${str(p, "personId")}`,
    render: (p, ctx) => {
      const week = weekLabel(str(p, "weekStart"));
      if (ctx.isSubject) {
        const shifts = strList(p, "shifts");
        return {
          emoji: "🔄",
          title: `Your schedule changed for the ${week}`,
          body: str(p, "change") || null,
          lines: shifts.length ? shifts : ["You have no shifts left this week."],
          href: scheduleHref(p),
          linkLabel: "View the schedule",
        };
      }
      return {
        emoji: "🔄",
        title: `Schedule change: ${str(p, "personName")}`,
        body: [str(p, "change"), week].filter(Boolean).join(" · "),
        href: scheduleHref(p),
        linkLabel: "View the schedule",
      };
    },
  },
  {
    type: "schedule.coverage_needed",
    group: "Scheduling",
    label: "Shift needs coverage",
    description:
      "A published shift for today or later is marked Absent or No-show. Turn on “Eligible staff” to also ask people in the same scheduling role who are free that day.",
    module: "schedule",
    sensitivity: "general",
    allowChannel: true,
    severity: "action",
    detailsNeedModule: true,
    defaults: rule({ audience: { roles: ["schedule_admin"] }, priority: "high" }),
    render: (p, ctx) => {
      // Who is out, and why, only for people who can open Scheduling.
      const detailed = !!ctx.moduleAccess && !ctx.isChannel && !!str(p, "personName");
      return {
        emoji: "🆘",
        title: detailed
          ? `Coverage needed: ${str(p, "personName")} · ${str(p, "dateLabel")}`
          : `Open shift: ${str(p, "dateLabel")}`,
        fields: [
          { label: "Shift", value: [str(p, "roleLabel"), str(p, "time")].filter(Boolean).join(" · ") },
          { label: "Location", value: str(p, "locationName") },
          { label: "Reason", value: detailed ? str(p, "reason") : "" },
        ].filter((f) => f.value),
        href: scheduleHref(p),
        linkLabel: "Open the schedule",
      };
    },
  },
  {
    type: "schedule.unpublished_reminder",
    group: "Scheduling",
    label: "Schedule not published yet",
    description:
      "From 10am each day: the current week isn't published, or (from Thursday) next week isn't. Staff only see published weeks in My Time, and punches are matched to published shifts.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    severity: "warning",
    defaults: rule({ audience: { roles: ["schedule_admin"] } }),
    render: (p) => ({
      emoji: "📣",
      title:
        str(p, "urgency") === "overdue"
          ? `This week's schedule isn't published (${weekLabel(str(p, "weekStart"))})`
          : `Next week's schedule isn't published yet (${weekLabel(str(p, "weekStart"))})`,
      body: str(p, "statusLabel")
        ? `It's still ${str(p, "statusLabel")}. Staff can't see it in My Time until it's published.`
        : "No schedule has been started for that week. Staff can't see it in My Time until it's published.",
      href: scheduleHref(p),
      linkLabel: "Open the schedule",
    }),
  },
  {
    type: "attendance.missed_shift",
    group: "Scheduling",
    label: "Missed shift recorded",
    description:
      "A scheduled shift is marked No-show, or (once time-clock attendance is on) nobody clocked in within the missed window. Goes to managers at that location.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    actions: ["ack"],
    severity: "warning",
    defaults: rule({ audience: { roles: ["manager"], sameLocation: true } }),
    render: (p) => ({
      emoji: "⚠️",
      title: `${str(p, "personName")} marked ${str(p, "statusLabel")} · ${str(p, "dateLabel")}`,
      fields: [
        { label: "Location", value: str(p, "locationName") },
        { label: "Note", value: str(p, "note") },
      ].filter((f) => f.value),
      href: scheduleHref(p),
      linkLabel: "Open the schedule",
    }),
  },

  // ------------------------------------------------------------------ Time clock
  {
    type: "timeclock.offsite_pending",
    group: "Time clock",
    label: "Off-site punch to approve",
    description:
      "An employee clocked in or out away from a clinic and chose “Working off-site” with a note. It counts once an approver approves it at Scheduling ▸ Time Clock.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    escalatable: true,
    severity: "action",
    // Batched into a digest: until a clinic's static IP is entered, desktop
    // punches there look off-site, and approvers shouldn't get one DM each.
    defaults: rule({ audience: { roles: ["manager"] }, batchMinutes: 30 }),
    messageKey: (id) => (id ? `timepunch:${id}` : null),
    render: (p, ctx) => ({
      emoji: "📍",
      title: `Off-site punch to approve: ${str(p, "personName")}`,
      fields: [
        { label: "Punch", value: [str(p, "punchLabel"), str(p, "when")].filter(Boolean).join(" · ") },
        { label: "Scheduled at", value: str(p, "locationName") },
        // The employee's note can be personal; keep it out of channel posts.
        { label: "Note", value: ctx.isChannel ? "" : clip(str(p, "note"), 300) },
      ].filter((f) => f.value),
      href: "/schedule/time-clock",
      linkLabel: "Review in Ops",
    }),
  },
  {
    type: "timeclock.punch_reviewed",
    group: "Time clock",
    label: "Off-site punch approved or rejected",
    description: "Tells the employee what happened to their off-site punch.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => {
      const approved = str(p, "decision") === "approved";
      const what = [str(p, "punchLabel").toLowerCase(), str(p, "when")].filter(Boolean).join(" ");
      return {
        emoji: approved ? "✅" : "❌",
        title: ctx.isSubject
          ? `Your off-site ${what} was ${approved ? "approved" : "not approved"}`
          : `Off-site punch ${approved ? "approved" : "rejected"}: ${str(p, "personName")}`,
        body: [
          approved ? null : "It no longer counts on your timecard. If you did work, ask your manager to add the correct punch.",
          str(p, "note") ? `Note: ${clip(str(p, "note"), 300)}` : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
        href: "/me/timecard",
        linkLabel: "View my timecard",
      };
    },
  },
  {
    type: "timeclock.correction_requested",
    group: "Time clock",
    label: "Time correction requested",
    description: "An employee asked to fix a missing or wrong punch.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    escalatable: true,
    severity: "action",
    defaults: rule({ audience: { roles: ["manager"] }, batchMinutes: 30 }),
    messageKey: (id) => (id ? `timecorr:${id}` : null),
    render: (p, ctx) => ({
      emoji: "🕒",
      title: `Time correction requested: ${str(p, "personName")}`,
      fields: [
        { label: "Day", value: str(p, "dateLabel") },
        { label: "Request", value: str(p, "request") },
        { label: "Reason", value: ctx.isChannel ? "" : clip(str(p, "reason"), 300) },
      ].filter((f) => f.value),
      href: "/schedule/time-clock",
      linkLabel: "Review in Ops",
    }),
  },
  {
    type: "timeclock.correction_decided",
    group: "Time clock",
    label: "Time correction approved or denied",
    description: "Tells the employee the outcome of their correction request.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => {
      const approved = str(p, "decision") === "approved";
      return {
        emoji: approved ? "✅" : "❌",
        title: ctx.isSubject
          ? `Your time correction for ${str(p, "dateLabel")} was ${approved ? "approved" : "denied"}`
          : `Time correction ${approved ? "approved" : "denied"}: ${str(p, "personName")} · ${str(p, "dateLabel")}`,
        body: str(p, "note") ? `Note: ${clip(str(p, "note"), 300)}` : null,
        href: "/me/timecard",
        linkLabel: "View my timecard",
      };
    },
  },
  {
    type: "timeclock.punch_added",
    group: "Time clock",
    label: "Punch added by a manager",
    description: "Tells the employee a manager added a punch to their timecard (e.g. a missing clock-out).",
    module: "schedule",
    sensitivity: "module",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => ({
      emoji: "✏️",
      title: ctx.isSubject
        ? `A ${str(p, "punchLabel").toLowerCase()} at ${str(p, "when")} was added to your timecard`
        : `Punch added for ${str(p, "personName")}: ${str(p, "punchLabel")} at ${str(p, "when")}`,
      body: str(p, "reason") ? `Reason: ${clip(str(p, "reason"), 300)}` : null,
      href: "/me/timecard",
      linkLabel: "View my timecard",
    }),
  },
  {
    type: "timeclock.missing_clock_out",
    group: "Time clock",
    label: "Missing clock-out",
    description:
      "Someone is still clocked in an hour after their shift ended (or 12 hours after clocking in, with no shift). Sent once per shift.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    severity: "warning",
    defaults: rule({ audience: { subjects: true, roles: ["manager"], sameLocation: true } }),
    render: (p, ctx) =>
      ctx.isSubject
        ? {
            emoji: "⏰",
            title: `You're still clocked in from ${str(p, "clockInLabel")}`,
            body: "If you've finished, clock out in My Time now. If you forgot earlier, request a correction with the time you left.",
            href: "/me",
            linkLabel: "Open My Time",
          }
        : {
            emoji: "⏰",
            title: `Missing clock-out: ${str(p, "personName")}`,
            fields: [
              { label: "Clocked in", value: str(p, "clockInLabel") },
              { label: "Shift", value: str(p, "shift") },
              { label: "Location", value: str(p, "locationName") },
            ].filter((f) => f.value),
            href: "/schedule/time-clock",
            linkLabel: "Open the time clock queue",
          },
  },

  {
    type: "attendance.late",
    group: "Scheduling",
    label: "Late clock-in",
    description:
      "Someone clocked in after the late threshold (time-clock attendance must be on). Goes to managers at that location; batched.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { roles: ["manager"], sameLocation: true }, batchMinutes: 30 }),
    render: (p) => ({
      emoji: "🕘",
      title: `${str(p, "personName")} clocked in ${str(p, "minutesLate")} min late · ${str(p, "dateLabel")}`,
      fields: [
        { label: "Shift", value: str(p, "shift") },
        { label: "Clocked in", value: str(p, "clockIn") },
        { label: "Location", value: str(p, "locationName") },
      ].filter((f) => f.value),
      href: "/schedule/time-attendance",
      linkLabel: "Open Time & Attendance",
    }),
  },

  // ------------------------------------------------------------------ Time off
  {
    type: "pto.requested",
    group: "Time off",
    label: "Time off requested",
    description: "A new PTO / vacation / time-off request is waiting for approval.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    actions: ["pto.approve", "pto.deny"],
    actionModule: "schedule",
    escalatable: true,
    severity: "action",
    defaults: rule({ audience: { roles: ["schedule_admin"] } }),
    messageKey: (id) => (id ? `pto:${id}` : null),
    render: (p, ctx) => ({
      emoji: "🏖️",
      title: `New time-off request: ${str(p, "personName")}`,
      fields: [
        { label: "Dates", value: str(p, "dates") },
        { label: "Type", value: str(p, "kindLabel") },
        { label: "Location", value: str(p, "locationName") },
        // A free-text note can be personal; keep it out of channel posts.
        { label: "Note", value: ctx.isChannel ? "" : clip(str(p, "note"), 300) },
        { label: "Status", value: "Pending approval" },
      ].filter((f) => f.value),
      href: str(p, "href") || "/schedule",
      linkLabel: "Review in Ops",
    }),
  },
  {
    type: "pto.approved",
    group: "Time off",
    label: "Time off approved",
    description: "Tells the employee their request was approved.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => ({
      emoji: "✅",
      title: ctx.isSubject
        ? `Your time off for ${str(p, "dates")} was approved`
        : `Time off approved: ${str(p, "personName")} · ${str(p, "dates")}`,
      body: str(p, "reviewerName") ? `Approved by ${str(p, "reviewerName")}.` : null,
    }),
  },
  {
    type: "pto.denied",
    group: "Time off",
    label: "Time off denied",
    description: "Tells the employee their request was denied.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p, ctx) => ({
      emoji: "❌",
      title: ctx.isSubject
        ? `Your time off for ${str(p, "dates")} was not approved`
        : `Time off denied: ${str(p, "personName")} · ${str(p, "dates")}`,
      body: str(p, "reviewerName")
        ? `Reviewed by ${str(p, "reviewerName")}. Talk to them if you have questions.`
        : null,
    }),
  },
  {
    type: "pto.modified",
    group: "Time off",
    label: "Time-off request changed",
    description: "A request's dates change, it is reopened, or it is withdrawn.",
    module: "schedule",
    sensitivity: "module",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { roles: ["schedule_admin"] } }),
    render: (p) => ({
      emoji: "✏️",
      title: `Time-off request ${str(p, "change") || "changed"}: ${str(p, "personName")}`,
      fields: [
        { label: "Dates", value: str(p, "dates") },
        { label: "Type", value: str(p, "kindLabel") },
      ].filter((f) => f.value),
      href: str(p, "href") || "/schedule",
      linkLabel: "Open in Ops",
    }),
  },

  // ------------------------------------------------------------------ Marketing
  {
    type: "marketing.event_created",
    group: "Marketing events",
    label: "Event created",
    description: "A new marketing / community event is added.",
    module: "marketing",
    sensitivity: "general",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { roles: ["marketing_admin"] } }),
    render: (p) => ({
      emoji: "📢",
      title: `New event: ${str(p, "name")}`,
      fields: [...marketingFields(p), { label: "Status", value: str(p, "status") }].filter((f) => f.value),
      href: "/marketing/events",
      linkLabel: "View event details",
    }),
  },
  {
    type: "marketing.event_updated",
    group: "Marketing events",
    label: "Event details updated",
    description:
      "An event's name, date, time, location or status changes. Assigned staff are included by default.",
    module: "marketing",
    sensitivity: "general",
    allowChannel: true,
    severity: "info",
    defaults: rule({ audience: { roles: ["marketing_admin"], subjects: true }, batchMinutes: 15 }),
    coalesceKey: (p) => `mkt:${str(p, "eventId")}`,
    render: (p) => ({
      emoji: "📢",
      title: `Event updated: ${str(p, "name")}`,
      body: strList(p, "changes").length ? `Changed: ${strList(p, "changes").join(", ")}` : null,
      fields: marketingFields(p),
      href: "/marketing/events",
      linkLabel: "View event details",
    }),
  },
  {
    type: "marketing.staff_assigned",
    group: "Marketing events",
    label: "Assigned to an event",
    description: "Tells employees they were added to an event's staff.",
    module: "marketing",
    sensitivity: "general",
    allowChannel: false,
    actions: ["ack"],
    severity: "action",
    defaults: rule({ audience: { subjects: true } }),
    render: (p) => ({
      emoji: "🙋",
      title: `You're staffing ${str(p, "name")}`,
      fields: [
        ...marketingFields(p).filter((f) => f.label !== "Staff"),
        { label: "Arrive", value: str(p, "arrival") },
        { label: "Parking", value: clip(str(p, "parking"), 200) },
      ].filter((f) => f.value),
      href: "/marketing/events",
      linkLabel: "View event details",
    }),
  },
  {
    type: "marketing.event_canceled",
    group: "Marketing events",
    label: "Event canceled",
    description: "An event is marked cancelled. Goes to its staff and the marketing team.",
    module: "marketing",
    sensitivity: "general",
    allowChannel: true,
    severity: "warning",
    defaults: rule({ audience: { roles: ["marketing_admin"], subjects: true }, priority: "high" }),
    render: (p) => ({
      emoji: "🚫",
      title: `Event canceled: ${str(p, "name")}`,
      fields: marketingFields(p),
      href: "/marketing/events",
      linkLabel: "View event details",
    }),
  },
  {
    type: "marketing.event_upcoming",
    group: "Marketing events",
    label: "Event reminder",
    description: "Reminds an event's staff the day before (sent mid-morning).",
    module: "marketing",
    sensitivity: "general",
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true } }),
    render: (p) => ({
      emoji: "⏰",
      title: `Tomorrow: ${str(p, "name")}`,
      fields: [
        ...marketingFields(p),
        { label: "Arrive", value: str(p, "arrival") },
        { label: "Parking", value: clip(str(p, "parking"), 200) },
      ].filter((f) => f.value),
      href: "/marketing/events",
      linkLabel: "View event details",
    }),
  },

  // ------------------------------------------------------------------ Direct (caller picks the recipient)
  {
    type: "task.assigned",
    group: "Tasks",
    label: "Task assigned",
    description: "Someone assigns you a task (in Ops or from a Slack workflow).",
    module: "dashboard",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    actions: ["task.complete"],
    severity: "action",
    defaults: rule({ audience: { subjects: true } }),
  },
  {
    type: "task.completed",
    group: "Tasks",
    label: "Task completed",
    description: "A task you assigned is completed.",
    module: "dashboard",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true }, deliverDm: false }),
  },
  {
    type: "task.dismissed",
    group: "Tasks",
    label: "Task dismissed",
    description: "A task you assigned is dismissed.",
    module: "dashboard",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true }, deliverDm: false }),
  },
  {
    type: "resource.updated",
    group: "Resources",
    label: "Policy document updated",
    description: "A policy document you're a recipient of is published or updated.",
    module: "resources",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    severity: "info",
    defaults: rule({ audience: { subjects: true }, deliverDm: false }),
  },
  {
    type: "resource.signature_requested",
    group: "Resources",
    label: "Policy signature requested",
    description: "A policy document needs your initials and date.",
    module: "resources",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    severity: "action",
    defaults: rule({ audience: { subjects: true }, deliverDm: false }),
  },
  {
    type: "ats.interview_booked",
    group: "Recruiting",
    label: "Interview booked",
    description: "A candidate books an interview with you.",
    module: "ats",
    sensitivity: "module",
    direct: true,
    allowChannel: false,
    severity: "action",
    defaults: rule({ audience: { subjects: true } }),
  },
];

export const EVENT_REGISTRY: ReadonlyMap<string, EventDefinition> = new Map(
  DEFINITIONS.map((d) => [d.type, d]),
);

export const EVENT_TYPES: string[] = DEFINITIONS.map((d) => d.type);

export function getEventDefinition(type: string): EventDefinition | null {
  return EVENT_REGISTRY.get(type) ?? null;
}

/** Group order for Admin ▸ Notifications. */
export const EVENT_GROUPS: string[] = [...new Set(DEFINITIONS.map((d) => d.group))];
