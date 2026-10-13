// The time-clock privacy notice (go-live plan §F). Bump the version when the
// text changes in substance: everyone is asked to acknowledge it again before
// their next punch.

export const TIME_CLOCK_NOTICE_VERSION = "2026-10-13";

export interface NoticeSection {
  heading: string;
  body: string;
}

export const TIME_CLOCK_NOTICE: NoticeSection[] = [
  {
    heading: "Why we record your time",
    body: "Green Dog keeps your time punches as the official record your pay is calculated from, as California law requires. Every punch is stamped with the server's clock, not your device's.",
  },
  {
    heading: "What is collected, and when",
    body: "Only at the moment you clock in, start or end lunch, or clock out: the time, the internet (IP) address your phone or computer is using, the browser or device type, and — if you allow it — your location and how accurate it is. Your location is never tracked between punches or when you are not punching.",
  },
  {
    heading: "How it is used",
    body: "To confirm the punch was made at a Green Dog clinic. If it was not, the punch is still recorded at the real time and goes to a manager to approve (for example, working off-site). You will never be stopped from punching.",
  },
  {
    heading: "Who can see it",
    body: "You can see your own punches and timecard. Location and network details are visible only to timecard approvers and payroll (Owner, Admin, Executive, HR / Manager). They are not shared outside Green Dog except with our payroll provider and as required by law.",
  },
  {
    heading: "How long it is kept",
    body: "Four years after the end of the pay period the punch belongs to. Punches are never edited: a correction is recorded alongside the original.",
  },
  {
    heading: "Your choices",
    body: "Location permission is optional; without it the punch may go to a manager for approval. If something on your timecard is wrong, request a correction from the Timecard tab.",
  },
];
