"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type CrmOrganization,
  type CrmContact,
  type OrgType,
  type ContactType,
  ORG_TYPE_LABELS,
  CONTACT_TYPE_LABELS,
} from "@/lib/crm/types";

const ORG_TYPES: OrgType[] = [
  "referral_clinic",
  "marketing_partner",
  "facility_resource",
  "med_ops",
];
const CONTACT_TYPES: ContactType[] = ["student", "ce_attendee"];

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

export function CrmExplorer({
  organizations,
  contacts,
}: {
  organizations: CrmOrganization[];
  contacts: CrmContact[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"organizations" | "contacts">("organizations");
  const [orgType, setOrgType] = useState<OrgType | "all">("all");
  const [contactType, setContactType] = useState<ContactType | "all">("all");
  const [query, setQuery] = useState("");

  const orgCounts = useMemo(() => {
    const c: Record<string, number> = { all: organizations.length };
    for (const o of organizations) c[o.org_type] = (c[o.org_type] ?? 0) + 1;
    return c;
  }, [organizations]);

  const contactCounts = useMemo(() => {
    const c: Record<string, number> = { all: contacts.length };
    for (const o of contacts) c[o.contact_type] = (c[o.contact_type] ?? 0) + 1;
    return c;
  }, [contacts]);

  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return organizations.filter((o) => {
      if (orgType !== "all" && o.org_type !== orgType) return false;
      if (!q) return true;
      return [o.name, o.subtype, o.contact_name, o.email, o.area, o.services]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [organizations, orgType, query]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (contactType !== "all" && c.contact_type !== contactType) return false;
      if (!q) return true;
      return [contactName(c), c.email, c.organization, c.school, c.program_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, contactType, query]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">CRM</h1>
          <p className="mt-1 text-sm text-slate-500">
            {organizations.length} organizations · {contacts.length} contacts
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

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {(["organizations", "contacts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition ${
              tab === t
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "organizations" ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill
              active={orgType === "all"}
              label="All"
              count={orgCounts.all}
              onClick={() => setOrgType("all")}
            />
            {ORG_TYPES.map((t) => (
              <Pill
                key={t}
                active={orgType === t}
                label={ORG_TYPE_LABELS[t]}
                count={orgCounts[t] ?? 0}
                onClick={() => setOrgType(t)}
              />
            ))}
          </div>

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
                {filteredOrgs.map((o) => (
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
                    <td className="px-4 py-2.5 text-slate-700">
                      {o.phone ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {o.area ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {o.status ?? "—"}
                    </td>
                  </tr>
                ))}
                {filteredOrgs.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-slate-400"
                    >
                      No organizations match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill
              active={contactType === "all"}
              label="All"
              count={contactCounts.all}
              onClick={() => setContactType("all")}
            />
            {CONTACT_TYPES.map((t) => (
              <Pill
                key={t}
                active={contactType === t}
                label={CONTACT_TYPE_LABELS[t]}
                count={contactCounts[t] ?? 0}
                onClick={() => setContactType(t)}
              />
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">School / Org</th>
                  <th className="px-4 py-3">Program</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredContacts.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/crm/contact/${c.id}`)}
                    className="cursor-pointer transition hover:bg-emerald-50"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {contactName(c)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {CONTACT_TYPE_LABELS[c.contact_type]}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.email ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.school ?? c.organization ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.program_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.status ?? "—"}
                    </td>
                  </tr>
                ))}
                {filteredContacts.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-slate-400"
                    >
                      No contacts match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
