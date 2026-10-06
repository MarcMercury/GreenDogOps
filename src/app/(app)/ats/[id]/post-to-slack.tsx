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

/**
 * One-time @channel announcement of a candidate. Once posted, later stage
 * changes and scheduled interviews reply in that post's thread, so the button
 * locks to "Announced ✓".
 */
export function AnnounceButton({
  announcedAt,
  onAnnounce,
}: {
  /** null = not yet announced; otherwise the announced_at timestamp (may be ""). */
  announcedAt: string | null;
  onAnnounce: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (announcedAt !== null) {
    const when = announcedAt
      ? new Date(announcedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
    return (
      <span
        title="Updates post in the announcement's Slack thread"
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
      >
        📣 Announced ✓{when ? ` ${when}` : ""}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Announce this candidate in the Slack recruiting channel? This @channel post notifies everyone.",
            )
          )
            return;
          setError(null);
          startTransition(async () => {
            const result = await onAnnounce();
            if (!result.ok) setError(result.error);
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
      >
        {pending ? "Announcing…" : "📣 Announce in Slack"}
      </button>
    </span>
  );
}
