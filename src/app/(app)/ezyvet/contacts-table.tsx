"use client";

import { fmtCurrency, fmtDate } from "../reporting/charts";
import { useTableSort, SortHeader, stickyHeadClass } from "../_components/data-views";

export interface ContactRow {
  id: string;
  ezyvet_contact_id: string;
  contact_code: string | null;
  full_name: string | null;
  business_name: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  physical_city: string | null;
  physical_state: string | null;
  customer_group: string | null;
  division: string | null;
  is_customer: boolean | null;
  is_active: boolean | null;
  revenue_spend_ytd: number | null;
  last_invoiced: string | null;
}

export function ContactsTable({ contacts }: { contacts: ContactRow[] }) {
  const sort = useTableSort(contacts, {
    name: (c) => c.full_name || c.business_name || "Unnamed",
    contact: (c) => c.email,
    location: (c) =>
      [c.physical_city, c.physical_state].filter(Boolean).join(", "),
    group: (c) => c.customer_group || c.division,
    revenue: (c) => c.revenue_spend_ytd,
    lastInvoiced: (c) => c.last_invoiced,
  });

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
            <SortHeader label="Name" sortKey="name" sort={sort} className="py-2 pr-3 font-semibold" />
            <SortHeader label="Contact" sortKey="contact" sort={sort} className="py-2 pr-3 font-semibold" />
            <SortHeader label="Location" sortKey="location" sort={sort} className="py-2 pr-3 font-semibold" />
            <SortHeader label="Group" sortKey="group" sort={sort} className="py-2 pr-3 font-semibold" />
            <SortHeader label="Rev YTD" sortKey="revenue" sort={sort} align="right" className="py-2 pr-3 font-semibold" />
            <SortHeader label="Last Invoiced" sortKey="lastInvoiced" sort={sort} className="py-2 pr-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((c) => (
            <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="py-2.5 pr-3">
                <div className="font-medium text-slate-800">
                  {c.full_name || c.business_name || "Unnamed"}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  {c.contact_code ? <span>#{c.contact_code}</span> : null}
                  {c.is_customer ? (
                    <span className="rounded bg-emerald-50 px-1 text-emerald-600">
                      Customer
                    </span>
                  ) : null}
                  {c.is_active === false ? (
                    <span className="rounded bg-slate-100 px-1 text-slate-500">
                      Inactive
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="py-2.5 pr-3 text-xs text-slate-500">
                <div className="truncate max-w-[200px]">{c.email || "—"}</div>
                <div className="text-slate-400">{c.mobile || c.phone || ""}</div>
              </td>
              <td className="py-2.5 pr-3 text-xs text-slate-500">
                {[c.physical_city, c.physical_state].filter(Boolean).join(", ") || "—"}
              </td>
              <td className="py-2.5 pr-3 text-xs text-slate-500">
                {c.customer_group || c.division || "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">
                {c.revenue_spend_ytd ? fmtCurrency(c.revenue_spend_ytd) : "—"}
              </td>
              <td className="py-2.5 pr-3 text-xs text-slate-500">
                {fmtDate(c.last_invoiced)}
              </td>
            </tr>
          ))}
          {contacts.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-sm text-slate-400">
                No contacts match your search.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
