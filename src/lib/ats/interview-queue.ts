// Default order for the ATS Interviews queue: chronological by date and start
// time. Interviews without a date follow, then unbooked scheduling links
// (ordered by the first offered date), since neither has a real time yet.

export interface QueueSortable {
  kind: "interview" | "invite";
  date: string | null;
  start_time: string | null;
}

function bucket(r: QueueSortable): number {
  if (r.kind === "invite") return 2;
  return r.date ? 0 : 1;
}

export function compareQueueRows(a: QueueSortable, b: QueueSortable): number {
  return (
    bucket(a) - bucket(b) ||
    (a.date ?? "").localeCompare(b.date ?? "") ||
    // A missing time sorts after timed interviews on the same day.
    (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
  );
}
