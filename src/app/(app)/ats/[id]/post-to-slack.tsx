"use client";

import { useState, useTransition } from "react";

/**
 * Posts a server-built summary to the Slack hiring channel. Confirms first,
 * since the message is visible to the whole channel and cannot be recalled.
 */
export function PostToSlackButton({
  onPost,
  confirmMessage,
  label = "Post to Slack",
  className,
}: {
  onPost: () => Promise<{ ok: true } | { ok: false; error: string }>;
  confirmMessage: string;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirmMessage)) return;
          setError(null);
          startTransition(async () => {
            const result = await onPost();
            if (result.ok) {
              setPosted(true);
              setTimeout(() => setPosted(false), 4000);
            } else {
              setError(result.error);
            }
          });
        }}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {pending ? "Posting…" : posted ? "Posted ✓" : `📣 ${label}`}
      </button>
    </span>
  );
}
