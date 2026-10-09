"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SlackAdminRow } from "@/lib/slack/link-sync";
import {
  SLACK_LINK_STATUS_LABELS,
  slackLinkNeedsAttention,
  type SlackLinkStatus,
} from "@/lib/slack/matching";
import {
  disconnectSlackLink,
  linkSlackAccount,
  retrySlackLink,
  searchSlackUsers,
  syncSlackUsersNow,
  type SlackAccountOption,
} from "./actions";

type Filter = "all" | "attention" | "connected" | "disconnected";

const STATUS_TONE: Record<SlackLinkStatus, string> = {
  connected: "bg-emerald-100 text-emerald-800",
  not_found: "bg-amber-100 text-amber-800",
  ambiguous: "bg-amber-100 text-amber-800",
  inactive: "bg-rose-100 text-rose-700",
  disconnected: "bg-slate-100 text-slate-600",
};

const STATUS_ICON: Record<SlackLinkStatus, string> = {
  connected: "✅",
  not_found: "⚠️",
  ambiguous: "⚠️",
  inactive: "⚠️",
  disconnected: "⏸",
};

function StatusPill({ status }: { status: SlackLinkStatus | null }) {
  if (!status) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        Not synced yet
      </span>
    );
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>
      {STATUS_ICON[status]} {SLACK_LINK_STATUS_LABELS[status]}
    </span>
  );
}

/** Admin ▸ Slack header button. */
export function SyncSlackButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg ? (
        <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await syncSlackUsersNow();
            setMsg(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
            router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

function SlackPicker({
  personId,
  personName,
  onDone,
}: {
  personId: string;
  personName: string;
  onDone: (message: string | null) => void;
}) {
  const [query, setQuery] = useState(personName);
  const [options, setOptions] = useState<SlackAccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [linking, startLink] = useTransition();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const res = await searchSlackUsers(q);
        if (res.ok) {
          setOptions(res.options);
          setError(null);
        } else {
          setOptions([]);
          setError(res.error);
        }
      });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Slack by name, @handle or email"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
        <button
          type="button"
          onClick={() => onDone(null)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {searching ? <p className="text-xs text-slate-400">Searching…</p> : null}
      {!searching && query.trim().length >= 2 && options.length === 0 && !error ? (
        <p className="text-xs text-slate-400">No active Slack accounts match.</p>
      ) : null}
      <ul className="divide-y divide-slate-100 rounded-lg bg-white">
        {(query.trim().length >= 2 ? options : []).map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 text-sm">
              <span className="font-medium text-slate-800">{o.name}</span>
              {o.handle ? <span className="text-slate-500"> — @{o.handle}</span> : null}
              {o.email ? <span className="block truncate text-xs text-slate-400">{o.email}</span> : null}
            </div>
            <button
              type="button"
              disabled={linking}
              onClick={() =>
                startLink(async () => {
                  const res = await linkSlackAccount(personId, o.id);
                  if (res.ok) onDone(res.message ?? "Connected.");
                  else setError(res.error);
                })
              }
              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Link
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  canEdit,
  canSearch,
}: {
  row: SlackAdminRow;
  canEdit: boolean;
  canSearch: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const link = row.link;
  const status = link?.status ?? null;

  function run(action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    start(async () => {
      const res = await action();
      setMsg(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
      router.refresh();
    });
  }

  const loginDiffers =
    row.loginEmail && row.loginEmail.toLowerCase() !== (row.opsEmail ?? "").toLowerCase();

  return (
    <tr className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50/60">
      <td className="px-5 py-3">
        <Link href={`/hr/${row.personId}`} className="font-medium text-slate-900 hover:text-emerald-700">
          {row.name}
        </Link>
        {row.status === "contractor" ? <p className="text-xs text-slate-400">Contractor</p> : null}
      </td>
      <td className="px-3 py-3 text-xs text-slate-600">
        <p>{row.opsEmail ?? <span className="text-slate-400">no email</span>}</p>
        {loginDiffers ? <p className="text-slate-400">login: {row.loginEmail}</p> : null}
      </td>
      <td className="px-3 py-3 text-xs">
        {link?.slackUserId ? (
          <>
            <p className="font-medium text-slate-800">
              {link.slackRealName ?? link.slackDisplayName ?? link.slackUserId}
            </p>
            <p className="text-slate-400">
              {link.slackDisplayName ? `@${link.slackDisplayName} · ` : ""}
              {link.slackEmail ?? link.slackUserId}
              {link.matchMethod === "manual" ? " · linked manually" : ""}
            </p>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusPill status={status} />
        {link?.lastError && status !== "connected" ? (
          <p className="mt-1 max-w-56 text-xs text-slate-500">{link.lastError}</p>
        ) : null}
        {msg ? (
          <p className={`mt-1 text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>
        ) : null}
      </td>
      {canEdit ? (
        <td className="px-5 py-3 text-right">
          <div className="flex flex-wrap justify-end gap-2 text-xs font-medium">
            {status !== "connected" ? (
              <button
                type="button"
                disabled={pending || !canSearch}
                onClick={() => run(() => retrySlackLink(row.personId))}
                className="text-emerald-700 hover:text-emerald-900 disabled:opacity-40"
              >
                Retry match
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending || !canSearch}
              onClick={() => setPicking((v) => !v)}
              className="text-sky-700 hover:text-sky-900 disabled:opacity-40"
            >
              {status === "connected" ? "Change" : "Select Slack user"}
            </button>
            {status === "connected" || status === "inactive" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Disconnect ${row.name} from Slack? The nightly sync won't re-link them.`)) {
                    run(() => disconnectSlackLink(row.personId));
                  }
                }}
                className="text-rose-700 hover:text-rose-900 disabled:opacity-40"
              >
                Disconnect
              </button>
            ) : null}
          </div>
          {picking ? (
            <div className="text-left">
              <SlackPicker
                personId={row.personId}
                personName={row.name}
                onDone={(message) => {
                  setPicking(false);
                  if (message) setMsg({ ok: true, text: message });
                  router.refresh();
                }}
              />
            </div>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

export function SlackLinksTable({
  rows,
  canEdit,
  canSearch,
}: {
  rows: SlackAdminRow[];
  canEdit: boolean;
  canSearch: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const s = r.link?.status;
      if (filter === "attention" && !slackLinkNeedsAttention(s)) return false;
      if (filter === "connected" && s !== "connected") return false;
      if (filter === "disconnected" && s !== "disconnected") return false;
      if (!q) return true;
      return [r.name, r.opsEmail, r.loginEmail, r.link?.slackRealName, r.link?.slackDisplayName, r.link?.slackEmail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, filter, query]);

  const tabs: { key: Filter; label: string }[] = [
    { key: "attention", label: "Need attention" },
    { key: "connected", label: "Connected" },
    { key: "disconnected", label: "Disconnected" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`rounded-md px-3 py-1 transition ${
                filter === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or email"
          className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <div className="-mx-5 -mb-5 max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-5 py-2.5">Employee</th>
              <th className="px-3 py-2.5">Ops email</th>
              <th className="px-3 py-2.5">Slack account</th>
              <th className="px-3 py-2.5">Status</th>
              {canEdit ? <th className="px-5 py-2.5"></th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-5 py-6 text-center text-sm text-slate-400">
                  Nobody here.
                </td>
              </tr>
            ) : (
              visible.map((r) => <Row key={r.personId} row={r} canEdit={canEdit} canSearch={canSearch} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
