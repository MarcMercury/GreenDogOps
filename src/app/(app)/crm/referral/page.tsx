import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
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

  const [partnersRes, visitsRes, historyRes, contactsRes, notesRes] = await Promise.all([
    supabase.from("referral_partners").select("*").order("name", { ascending: true }),
    supabase
      .from("clinic_visits")
      .select("id, created_at, partner_id, clinic_name, visit_date, spoke_to, items_discussed, next_visit_date, visit_notes")
      .order("visit_date", { ascending: false }),
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

  // Derive unmatched upload entries from the most recent sync details.
  const unmatchedMap = new Map<string, UnmatchedEntry>();
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

  return (
    <ReferralCrm
      partners={partners}
      visits={visits}
      history={history}
      unmatched={unmatched}
      contacts={contacts}
      notes={notes}
      isAdmin={isAdmin}
    />
  );
}
