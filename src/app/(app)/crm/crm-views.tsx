"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type CrmOrganization,
  type CrmContact,
  type OrgType,
  ORG_TYPE_LABELS,
} from "@/lib/crm/types";

function contactName(c: CrmContact): string {
  if (c.full_name) return c.full_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function Pill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-medium transition ${
        active
          ? "bg-emerald-600 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function Header({
  icon,
  title,
  description,
  count,
  query,
  setQuery,
}: {
  icon: string;
  title: string;
  description: string;
  count: number;
  query: string;
  setQuery: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <span aria-hidden>{icon}</span>
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {description} · {count} records
        </p>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  );
}

export function OrgListView({
  organizations,
  title,
  description,
  icon,
  showTypePills = false,
}: {
  organizations: CrmOrganization[];
  title: string;
  description: string;
  icon: string;
  showTypePills?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [orgType, setOrgType] = useState<OrgType | "all">("all");

  const types = useMemo(() => {
    const seen = new Set<OrgType>();
    for (const o of organizations) seen.add(o.org_type);
    return [...seen];
  }, [organizations]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: organizations.length };
    for (const o of organizations) c[o.org_type] = (c[o.org_type] ?? 0) + 1;
    return c;
  }, [organizations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return organizations.filter((o) => {
      if (showTypePills && orgType !== "all" && o.org_type !== orgType)
        return false;
      if (!q) return true;
      return [o.name, o.subtype, o.contact_name, o.email, o.area, o.services]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [organizations, orgType, query, showTypePills]);

  return (
    <div className="mx-auto max-w-7xl">
      <Header
        icon={icon}
        title={title}
        description={description}
        count={organizations.length}
        query={query}
        setQuery={setQuery}
      />

      {showTypePills && types.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill
            active={orgType === "all"}
            label="All"
            count={counts.all}
            onClick={() => setOrgType("all")}
          />
          {types.map((t) => (
            <Pill
              key={t}
              active={orgType === t}
              label={ORG_TYPE_LABELS[t]}
              count={counts[t] ?? 0}
              onClick={() => setOrgType(t)}
            />
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/crm/org/${o.id}`)}
                className="cursor-pointer transition hover:bg-emerald-50"
              >
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {o.name}
                  {o.is_preferred && (
                    <span className="ml-1.5 text-amber-500">★</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {o.subtype ?? ORG_TYPE_LABELS[o.org_type]}
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  {o.contact_name ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{o.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-700">{o.area ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {o.status ?? "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  No records match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ContactListView({
  contacts,
  title,
  description,
  icon,
  variant,
}: {
  contacts: CrmContact[];
  title: string;
  description: string;
  icon: string;
  variant: "student" | "ce";
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!q) return true;
      return [
        contactName(c),
        c.email,
        c.phone,
        c.organization,
        c.school,
        c.program_name,
        c.lead_source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, query]);

  return (
    <div className="mx-auto max-w-7xl">
      <Header
        icon={icon}
        title={title}
        description={description}
        count={contacts.length}
        query={query}
        setQuery={setQuery}
      />

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {variant === "student" ? (
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">School / Org</th>
                <th className="px-4 py-3">Program</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">CE Events</th>
                <th className="px-4 py-3">Lead Source</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/crm/contact/${c.id}`)}
                className="cursor-pointer transition hover:bg-emerald-50"
              >
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {contactName(c)}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{c.email ?? "—"}</td>
                {variant === "student" ? (
                  <>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.school ?? c.organization ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.program_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.status ?? "—"}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.ce_events_attended ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.lead_source ?? "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  No records match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
