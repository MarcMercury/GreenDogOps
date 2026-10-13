"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeTimeClockNotice } from "./actions";

export function AcceptNoticeButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acknowledgeTimeClockNotice();
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Saving…" : "I have read this notice"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
