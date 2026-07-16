"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getReportingRefreshedAt } from "./actions";

const POLL_MS = 30_000;

/**
 * Polls the server-side reporting refresh timestamp and re-fetches the page
 * once a rebuild completes, so the Reports page catches up automatically after
 * an agent ingest (the DB matviews refresh ~1 min later via pg_cron, but the
 * open page would otherwise stay stale until a manual reload). Renders a small
 * "just updated" hint when it refreshes.
 */
export function ReportingAutoRefresh({
  initialRefreshedAt,
}: {
  initialRefreshedAt: string | null;
}) {
  const router = useRouter();
  const lastSeen = useRef(initialRefreshedAt);
  const [, startTransition] = useTransition();
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const refreshedAt = await getReportingRefreshedAt();
        if (cancelled || !refreshedAt) return;
        if (refreshedAt !== lastSeen.current) {
          lastSeen.current = refreshedAt;
          setJustUpdated(true);
          startTransition(() => router.refresh());
          window.setTimeout(() => {
            if (!cancelled) setJustUpdated(false);
          }, 4000);
        }
      } catch {
        // Ignore transient polling errors; try again next tick.
      }
    }

    const id = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (!justUpdated) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Reports just updated
    </span>
  );
}
