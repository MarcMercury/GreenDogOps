"use client";

import { useId, useState } from "react";

export interface CardBadge {
  value: number | string;
  /** Tailwind classes for the pill, e.g. "bg-rose-100 text-rose-700". */
  tone: string;
  title?: string;
}

/**
 * Dashboard section that starts collapsed. Badges stay in the header so a
 * collapsed section still shows whether anything is waiting; header actions
 * appear only while it is open.
 */
export function CollapsibleCard({
  title,
  subtitle,
  badges = [],
  actions,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badges?: CardBadge[];
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${open ? "border-b border-slate-100" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="group -m-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <span
            aria-hidden
            className={`text-xs text-slate-400 transition-transform duration-150 group-hover:text-slate-600 ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-slate-900">{title}</span>
              {badges
                .filter((b) => b.value !== 0 && b.value !== "")
                .map((b, i) => (
                  <span
                    key={i}
                    title={b.title}
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${b.tone}`}
                  >
                    {b.value}
                  </span>
                ))}
            </span>
            {subtitle ? <span className="block text-xs text-slate-500">{subtitle}</span> : null}
          </span>
        </button>
        {open && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}
