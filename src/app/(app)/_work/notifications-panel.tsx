"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotificationRow } from "@/lib/worklist/sources";
import { isSlackLink } from "@/lib/worklist/items";
import { MODULE_ICONS, isModuleKey } from "@/lib/shared/module-icons";
import { archiveNotification, markNotificationsRead } from "./actions";

const SEVERITY_ICON: Record<NotificationRow["severity"], string> = {
  action: "👉",
  warning: "⚠️",
  info: "🔔",
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NotificationItem({ n }: { n: NotificationRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = !n.read_at;
  const icon = isModuleKey(n.module) ? MODULE_ICONS[n.module] : SEVERITY_ICON[n.severity];

  const markRead = () =>
    start(async () => {
      if (unread) await markNotificationsRead([n.id]);
      router.refresh();
    });

  const body = (
    <>
      <p className={`text-sm ${unread ? "font-semibold text-slate-900" : "text-slate-600"}`}>{n.title}</p>
      {n.body ? <p className="text-xs text-slate-500">{n.body}</p> : null}
      <p className="text-[11px] text-slate-400">{ago(n.created_at)}</p>
    </>
  );

  return (
    <li className={`group flex items-start gap-2.5 px-4 py-2.5 ${unread ? "bg-emerald-50/40" : ""} ${pending ? "opacity-50" : ""}`}>
      <span className="mt-0.5 text-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        {n.href ? (
          isSlackLink(n.href) ? (
            <a href={n.href} target="_blank" rel="noopener noreferrer" onClick={markRead} className="block hover:opacity-80">
              {body}
            </a>
          ) : (
            <Link href={n.href} onClick={markRead} className="block hover:opacity-80">
              {body}
            </Link>
          )
        ) : (
          <button type="button" onClick={markRead} className="block w-full text-left">
            {body}
          </button>
        )}
      </div>
      <button
        type="button"
        title="Clear"
        aria-label="Clear notification"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await archiveNotification(n.id);
            router.refresh();
          })
        }
        className="shrink-0 rounded px-1 text-xs text-slate-300 opacity-0 transition hover:text-slate-600 group-hover:opacity-100 focus:opacity-100"
      >
        ✕
      </button>
    </li>
  );
}

export function NotificationsPanel({ items, unread }: { items: NotificationRow[]; unread: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Notifications{" "}
            {unread > 0 ? (
              <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
            ) : null}
          </h2>
          <p className="text-xs text-slate-500">Updates from Ops for you.</p>
        </div>
        {unread > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markNotificationsRead("all");
                router.refresh();
              })
            }
            className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
          >
            Mark all read
          </button>
        ) : null}
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-slate-400">You&apos;re all caught up.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-slate-50 overflow-y-auto">
          {items.map((n) => (
            <NotificationItem key={n.id} n={n} />
          ))}
        </ul>
      )}
    </section>
  );
}
