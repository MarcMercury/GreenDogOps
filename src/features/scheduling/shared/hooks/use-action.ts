"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  toastResult,
  toastThrown,
  type SuccessMessage,
  type ToastableResult,
} from "@/features/scheduling/shared/lib/action-toast";

export interface RunActionOptions<R extends ToastableResult> {
  /** Re-fetch the page's server data after a success (default true). */
  refresh?: boolean;
  onSuccess?: (result: Extract<R, { ok: true }>) => void;
  onError?: (error: string) => void;
}

/**
 * The one way a client component calls a Server Action from a button, chip or
 * inline control: inside a transition, with the outcome toasted and the
 * page's data refreshed on success. Returns a promise that settles when the
 * action and its toast are done, so dialogs can keep their pending state.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <R extends ToastableResult>(
      action: () => Promise<R>,
      success: SuccessMessage<R>,
      options: RunActionOptions<R> = {},
    ): Promise<R | null> =>
      new Promise((resolve) => {
        startTransition(async () => {
          let result: R;
          try {
            result = await action();
          } catch (error) {
            toastThrown(error);
            resolve(null);
            return;
          }
          toastResult(result, success);
          if (result.ok) {
            options.onSuccess?.(result as Extract<R, { ok: true }>);
            if (options.refresh !== false) router.refresh();
          } else {
            options.onError?.(result.error);
          }
          resolve(result);
        });
      }),
    [router],
  );

  return { run, pending };
}
