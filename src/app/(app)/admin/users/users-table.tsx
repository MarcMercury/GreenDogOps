"use client";

import Link from "next/link";
import type { AppRole } from "@/lib/auth/permissions";
import { RoleBadge } from "../_components";
import { useTableSort, SortHeader, stickyHeadClass } from "../../_components/data-views";

export interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
  person_id: string | null;
  rosterName: string | null;
  rosterTitle: string | null;
  role: AppRole;
  is_active: boolean;
  last_seen_at: string | null;
}

function lastSeen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UsersTable({ users }: { users: UserRow[] }) {
  const sort = useTableSort(users, {
    user: (u) => u.full_name ?? u.email,
    roster: (u) => u.rosterName,
    role: (u) => u.role,
    status: (u) => (u.is_active ? 1 : 0),
    lastSeen: (u) => u.last_seen_at,
  });

  return (
    <div className="-mx-5 -mb-5 max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
            <SortHeader label="User" sortKey="user" sort={sort} className="px-5 py-2.5" />
            <SortHeader label="Roster profile" sortKey="roster" sort={sort} className="px-3 py-2.5" />
            <SortHeader label="Role" sortKey="role" sort={sort} className="px-3 py-2.5" />
            <SortHeader label="Status" sortKey="status" sort={sort} className="px-3 py-2.5" />
            <SortHeader label="Last seen" sortKey="lastSeen" sort={sort} className="px-3 py-2.5" />
            <th className="px-5 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((u) => (
            <tr
              key={u.id}
              className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
            >
              <td className="px-5 py-3">
                <p className="font-medium text-slate-900">
                  {u.full_name ?? u.email}
                </p>
                {u.full_name ? (
                  <p className="text-xs text-slate-400">{u.email}</p>
                ) : null}
              </td>
              <td className="px-3 py-3">
                {u.rosterName ? (
                  <Link
                    href={`/hr/${u.person_id}`}
                    className="font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    {u.rosterName}
                    {u.rosterTitle ? (
                      <span className="block text-xs font-normal text-slate-400">
                        {u.rosterTitle}
                      </span>
                    ) : null}
                  </Link>
                ) : (
                  <span className="text-xs font-medium text-amber-600">
                    ⚠ No roster profile
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                <RoleBadge role={u.role} />
              </td>
              <td className="px-3 py-3">
                {u.is_active ? (
                  <span className="text-emerald-600">● Active</span>
                ) : (
                  <span className="text-slate-400">○ Inactive</span>
                )}
              </td>
              <td className="px-3 py-3 text-slate-500">{lastSeen(u.last_seen_at)}</td>
              <td className="px-5 py-3 text-right">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                >
                  Manage →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
