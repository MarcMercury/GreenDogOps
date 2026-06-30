"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function ContactSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    next.delete("page");
    startTransition(() => router.push(`/ezyvet?${next.toString()}`));
  }

  const filter = params.get("filter") ?? "all";
  function setFilter(f: string) {
    const next = new URLSearchParams(params.toString());
    if (f === "all") next.delete("filter");
    else next.set("filter", f);
    next.delete("page");
    startTransition(() => router.push(`/ezyvet?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={submit} className="flex flex-1 items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search name, business, email, or code…"
          className="w-full min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
        >
          Search
        </button>
      </form>
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
        {[
          { k: "all", label: "All" },
          { k: "customers", label: "Customers" },
          { k: "active", label: "Active" },
        ].map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => setFilter(opt.k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === opt.k
                ? "bg-emerald-50 text-emerald-700"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
