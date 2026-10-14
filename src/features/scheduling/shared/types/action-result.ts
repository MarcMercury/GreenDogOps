/**
 * Result shape returned by every Scheduling Server Action. A failure carries one
 * user-facing message; a success optionally carries a payload (an id, counts…).
 * `ensureCanEdit()` and `parseForm()` / `parseInput()` return the same failure
 * shape, so an action can return their result directly.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
