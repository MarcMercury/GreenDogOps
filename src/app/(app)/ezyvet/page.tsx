import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole, canEditModule } from "@/lib/auth/permissions";
import type { ClientSummary, ContactImportRow } from "@/lib/reporting/types";
import { PageHeader } from "../_components/ui";
import { StatCard, SectionCard, fmtCurrency, fmtNumber, fmtDate } from "../reporting/charts";
import { ContactUploader } from "./contact-uploader";
import { ContactSearch } from "./contact-search";
import { ContactImportHistory } from "./contact-import-history";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface ContactRow {
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

export default async function EzyvetCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const { q, filter, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;
  const canEdit = current ? canEditModule(current.appUser, "ezyvet") : false;

  let query = supabase
    .from("ezyvet_contact")
    .select(
      "id, ezyvet_contact_id, contact_code, full_name, business_name, email, mobile, phone, physical_city, physical_state, customer_group, division, is_customer, is_active, revenue_spend_ytd, last_invoiced",
      { count: "exact" },
    );

  if (q && q.trim()) {
    const term = q.trim().replace(/[,()%*]/g, " ");
    query = query.or(
      [
        `full_name.ilike.%${term}%`,
        `business_name.ilike.%${term}%`,
        `email.ilike.%${term}%`,
        `contact_code.ilike.%${term}%`,
      ].join(","),
    );
  }
  if (filter === "customers") query = query.eq("is_customer", true);
  if (filter === "active") query = query.eq("is_active", true);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [contactsRes, summaryRes, importsRes] = await Promise.all([
    query
      .order("revenue_spend_ytd", { ascending: false, nullsFirst: false })
      .range(from, to),
    supabase.from("report_client_summary").select("*").maybeSingle(),
    supabase
      .from("ezyvet_contact_import")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const contacts = (contactsRes.data ?? []) as ContactRow[];
  const total = contactsRes.count ?? 0;
  const summary = (summaryRes.data as ClientSummary | null) ?? null;
  const imports = (importsRes.data ?? []) as ContactImportRow[];
  const hasData = (summary?.total_contacts ?? 0) > 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (filter) sp.set("filter", filter);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/ezyvet?${s}` : "/ezyvet";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Veterinary CRM"
        title="ezyVet CRM"
        description="Your ezyVet contact records, kept current through periodic exports. New clients are added and existing records updated on each upload."
      />

      {canEdit ? <ContactUploader /> : null}

      {hasData ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total Contacts"
            value={fmtNumber(summary?.total_contacts)}
            sub={`${fmtNumber(summary?.active_contacts)} active`}
          />
          <StatCard
            label="Customers"
            value={fmtNumber(summary?.customers)}
            accent="indigo"
          />
          <StatCard
            label="Businesses"
            value={fmtNumber(summary?.businesses)}
            accent="sky"
          />
          <StatCard
            label="Revenue YTD"
            value={fmtCurrency(summary?.total_revenue_ytd)}
            accent="emerald"
          />
        </div>
      ) : null}

      {!hasData ? (
        <SectionCard
          title="No contacts yet"
          description="Upload an ezyVet Contacts export (.csv) to build the CRM."
        >
          <p className="text-sm text-slate-500">
            This becomes the client roster that powers the{" "}
            <Link className="font-medium text-emerald-600 underline" href="/reporting">
              Reporting
            </Link>{" "}
            page&apos;s Client Data &amp; Trends. Each upload is treated as the
            latest snapshot — new contacts are added and changed records updated.
          </p>
        </SectionCard>
      ) : (
        <SectionCard
          title={`Contacts (${fmtNumber(total)})`}
          description="Sorted by revenue spend YTD."
          action={
            <Link
              href="/reporting"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              View trends →
            </Link>
          }
        >
          <div className="mb-4">
            <ContactSearch />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Contact</th>
                  <th className="py-2 pr-3 font-semibold">Location</th>
                  <th className="py-2 pr-3 font-semibold">Group</th>
                  <th className="py-2 pr-3 text-right font-semibold">Rev YTD</th>
                  <th className="py-2 pr-3 font-semibold">Last Invoiced</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
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

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                Page {page} of {fmtNumber(totalPages)}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    ← Prev
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Next →
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </SectionCard>
      )}

      <SectionCard
        title="Upload history"
        description="Each contact snapshot, with new vs. updated tallies."
      >
        <ContactImportHistory imports={imports} isAdmin={isAdmin} />
      </SectionCard>
    </div>
  );
}
