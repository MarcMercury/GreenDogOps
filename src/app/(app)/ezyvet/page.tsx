import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole, canEditModule } from "@/lib/auth/permissions";
import type { ClientSummary, ContactImportRow } from "@/lib/reporting/types";
import { PageHeader } from "../_components/ui";
import { StatCard, SectionCard, fmtCurrency, fmtNumber } from "../reporting/charts";
import { ContactUploader } from "./contact-uploader";
import { ContactSearch } from "./contact-search";
import { ContactImportHistory } from "./contact-import-history";
import { ContactsTable, type ContactRow } from "./contacts-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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
          <ContactsTable contacts={contacts} />

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
