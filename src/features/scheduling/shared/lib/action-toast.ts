import { toast } from "react-toastify";

/**
 * Every Scheduling Server Action resolves to `{ ok: true, … }` or
 * `{ ok: false, error }` (`ActionResult`, `PayrollResult`, `ApproverResult`,
 * `SetWeekStatusResult`). This is the common shape the toasts need.
 */
export type ToastableResult = { ok: true } | { ok: false; error: string };

/** A fixed message, one derived from the successful result, or `null` to stay quiet. */
export type SuccessMessage<R extends ToastableResult> =
  | string
  | ((result: Extract<R, { ok: true }>) => string | null)
  | null;

const SUCCESS_MS = 2500;
const ERROR_MS = 6000;

/**
 * Show the outcome of a database save: a short success toast, or the action's
 * own error message. Returns the result unchanged so it can be chained.
 */
export function toastResult<R extends ToastableResult>(result: R, success: SuccessMessage<R>): R {
  if (result.ok) {
    const message =
      typeof success === "function" ? success(result as Extract<R, { ok: true }>) : success;
    if (message) toast.success(message, { autoClose: SUCCESS_MS });
  } else {
    toast.error(result.error, { autoClose: ERROR_MS });
  }
  return result;
}

/** The toast for a form that failed its zod validation (the fields show the detail). */
export function toastInvalidForm(): void {
  toast.error("Please fix the highlighted fields.", { autoClose: ERROR_MS });
}

/** A client-side refusal that never reached an action ("Open a week first…"). */
export function toastError(message: string): void {
  toast.error(message, { autoClose: ERROR_MS });
}

/** A thrown error (network, unexpected) rather than an action's `{ ok: false }`. */
export function toastThrown(error: unknown): void {
  toast.error(error instanceof Error && error.message ? error.message : "Something went wrong.", {
    autoClose: ERROR_MS,
  });
}
