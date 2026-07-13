import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole, canEditModule } from "@/lib/auth/permissions";
import type {
  ReferralPartner,
  ClinicVisit,
  SyncHistoryRow,
  UnmatchedEntry,
  PartnerContact,
  PartnerNote,
} from "@/lib/crm/referral-types";
import { ReferralCrm } from "./referral-crm";

export const dynamic = "force-dynamic";

interface ClinicDetail {
  clinicName: string;
  matched: boolean;
  visits: number;
  revenue: number;
}

export default async function ReferralCrmPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;
  const canEdit = current ? canEditModule(current.appUser, "crm_referral") : false;

  const [partnersRes, visitsRes, historyRes, contactsRes, notesRes] = await Promise.all([
    fetchAllRows<ReferralPartner>((from, to) =>
      supabase.from("referral_partners").select("*").order("name", { ascending: true }).range(from, to),
    ),
    fetchAllRows<ClinicVisit>((from, to) =>
      supabase
        .from("clinic_visits")
        .select("id, created_at, partner_id, clinic_name, visit_date, spoke_to, items_discussed, next_visit_date, visit_notes")
        .order("visit_date", { ascending: false })
        .range(from, to),
    ),
    supabase
      .from("referral_sync_history")
      .select("*")
      .order("upload_date", { ascending: false })
      .limit(50),
    supabase
      .from("partner_contacts")
      .select("*")
      .order("is_primary", { ascending: false }),
    supabase
      .from("partner_notes")
      .select("*")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (partnersRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Referral CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load referral partners: {partnersRes.error.message}
        </p>
      </div>
    );
  }

  const partners = (partnersRes.data ?? []) as ReferralPartner[];
  const visits = (visitsRes.data ?? []) as ClinicVisit[];
  const history = (historyRes.data ?? []) as SyncHistoryRow[];
  const contacts = (contactsRes.data ?? []) as PartnerContact[];
  const notes = (notesRes.data ?? []) as PartnerNote[];

  // Referral sources that appear in uploaded revenue but are NOT linked to any
  // partner ("Match" candidates). Sourced from orphaned ledger rows (partner_id
  // is null) so bulk imports surface here too, not only interactive uploads.
  const { data: orphanRows } = await fetchAllRows<{
    csv_clinic_name: string | null;
    amount: number | null;
    transaction_date: string | null;
    upload_id: string | null;
  }>((from, to) =>
    supabase
      .from("referral_revenue_line_items")
      .select("csv_clinic_name, amount, transaction_date, upload_id")
      .is("partner_id", null)
      .range(from, to),
  );

  // Derive unmatched upload entries. Any clinic that now corresponds to an
  // existing partner (e.g. it was just quick-added) is treated as resolved and
  // dropped from the list.
  const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const partnerNameSet = new Set(
    partners.map((p) => normalizeName(p.name ?? p.hospital_name ?? "")).filter(Boolean),
  );
  const historyDateById = new Map(history.map((h) => [h.id, h.upload_date]));
  const unmatchedMap = new Map<string, UnmatchedEntry>();

  // 1) Orphaned ledger rows — authoritative, carry real revenue + dates.
  const orphanAgg = new Map<
    string,
    { visits: number; revenue: number; minDate: string | null; maxDate: string | null; uploadDate: string | null }
  >();
  for (const r of orphanRows ?? []) {
    const name = (r.csv_clinic_name ?? "").trim();
    if (!name) continue;
    if (partnerNameSet.has(normalizeName(name))) continue;
    const e = orphanAgg.get(name) ?? { visits: 0, revenue: 0, minDate: null, maxDate: null, uploadDate: null };
    e.visits += 1;
    e.revenue += Number(r.amount) || 0;
    const d = r.transaction_date;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      if (!e.minDate || d < e.minDate) e.minDate = d;
      if (!e.maxDate || d > e.maxDate) e.maxDate = d;
    }
    const up = r.upload_id ? historyDateById.get(r.upload_id) : null;
    if (up && (!e.uploadDate || up > e.uploadDate)) e.uploadDate = up;
    orphanAgg.set(name, e);
  }
  for (const [name, e] of orphanAgg) {
    unmatchedMap.set(name.toLowerCase(), {
      clinicName: name,
      visits: e.visits,
      revenue: Math.round(e.revenue * 100) / 100,
      uploadDate: e.uploadDate ?? e.maxDate ?? "",
      dateRange: e.minDate && e.maxDate ? `${e.minDate} → ${e.maxDate}` : "—",
    });
  }

  // 2) Statistics-only unmatched clinics from interactive upload sync details.
  for (const h of history) {
    const details = (h.sync_details?.clinicDetails as ClinicDetail[] | undefined) ?? [];
    const range =
      h.date_range_start && h.date_range_end
        ? `${h.date_range_start} → ${h.date_range_end}`
        : "—";
    for (const d of details) {
      if (d.matched) continue;
      const key = d.clinicName.toLowerCase();
      if (unmatchedMap.has(key)) continue;
      if (partnerNameSet.has(normalizeName(d.clinicName))) continue;
      unmatchedMap.set(key, {
        clinicName: d.clinicName,
        visits: d.visits,
        revenue: d.revenue,
        uploadDate: h.upload_date,
        dateRange: range,
      });
    }
  }
  const unmatched = Array.from(unmatchedMap.values()).sort((a, b) => b.revenue - a.revenue);

  // Browser-safe, referrer-restricted Maps key for the interactive Map View.
  const mapsApiKey =
    process.env.GOOGLE_MAPS_PUBLIC_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

  return (
    <ReferralCrm
      partners={partners}
      visits={visits}
      history={history}
      unmatched={unmatched}
      contacts={contacts}
      notes={notes}
      isAdmin={isAdmin}
      canEdit={canEdit}
      mapsApiKey={mapsApiKey}
    />
  );
}
