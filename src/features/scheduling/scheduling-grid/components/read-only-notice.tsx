"use client";

/** Shown above the grid when the signed-in role may open the schedule but not edit it. */
export function ReadOnlyNotice() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      You have read-only access to the schedule. Changes are disabled.
    </div>
  );
}
