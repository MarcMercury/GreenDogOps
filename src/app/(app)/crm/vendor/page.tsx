import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditModule } from "@/lib/auth/permissions";
import {
  type CrmOrganization,
  type CrmOrgVisit,
  type CrmRetailLead,
  type OrgActivityLogEntry,
  NON_MED_CATEGORY,
  RESCUE_SUBTYPE,
} from "@/lib/crm/types";
import { PartnerCrm } from "./partner-crm";
import type { EmailTemplate } from "@/lib/crm/email-templates";

export const dynamic = "force-dynamic";

export default async function NonMedPartnerCrmPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "crm_vendor") : false;

  const partnersRes = await fetchAllRows<CrmOrganization>((from, to) =>
    supabase
      .from("crm_organization")
      .select("*")
      .in("org_type", [
        "marketing_partner",
        "facility_resource",
        "med_ops",
        "office_marketing",
      ])
      .eq("category", NON_MED_CATEGORY)
      // Rescues & shelters have their own Rescue/Shelter CRM.
      .or(`subtype.is.null,subtype.neq.${RESCUE_SUBTYPE}`)
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (partnersRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Non-Med Partners</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load partners: {partnersRes.error.message}
        </p>
      </div>
    );
  }

  const partners = partnersRes.data ?? [];
  const orgIds = partners.map((p) => p.id);

  // Visit / activity log for these partners (chunk the id filter to stay within
  // URL length limits on large lists).
  const visits: CrmOrgVisit[] = [];
  if (orgIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < orgIds.length; i += CHUNK) {
      const slice = orgIds.slice(i, i + CHUNK);
      const { data } = await fetchAllRows<CrmOrgVisit>((from, to) =>
        supabase
          .from("crm_org_visit")
          .select("*")
          .in("org_id", slice)
          .order("visit_date", { ascending: false })
          .range(from, to),
      );
      if (data) visits.push(...data);
    }
    visits.sort((a, b) => (a.visit_date < b.visit_date ? 1 : -1));
  }

  // QR-scan leads captured at these partners (same chunking rationale).
  const retailLeads: CrmRetailLead[] = [];
  if (orgIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < orgIds.length; i += CHUNK) {
      const slice = orgIds.slice(i, i + CHUNK);
      const { data } = await fetchAllRows<CrmRetailLead>((from, to) =>
        supabase
          .from("crm_retail_lead")
          .select("*")
          .in("org_id", slice)
          .order("scanned_at", { ascending: false })
          .range(from, to),
      );
      if (data) retailLeads.push(...data);
    }
    retailLeads.sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
  }

  // `||` (not `??`): an env var defined as an empty string must still fall back.
  const mapsApiKey =
    process.env.GOOGLE_MAPS_PUBLIC_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

  // Full activity feed — every mutation to a partner record is recorded in the
  // shared audit_log (record edits, notes, documents, visits, deletions). The
  // admin client is required because audit_log is not readable under RLS.
  const admin = createAdminClient();
  const auditRowMap = new Map<
    string,
    {
      id: string;
      actor_id: string | null;
      actor_email: string | null;
      action: string;
      entity: string | null;
      entity_id: string | null;
      summary: string | null;
      created_at: string;
    }
  >();
  const orgIdSet = new Set(orgIds);

  // 1) Entries tied to a current partner record (edits, notes, docs, visits).
  if (orgIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < orgIds.length; i += CHUNK) {
      const slice = orgIds.slice(i, i + CHUNK);
      const { data } = await admin
        .from("audit_log")
        .select("id, actor_id, actor_email, action, entity, entity_id, summary, created_at")
        .eq("entity", "crm_organization")
        .in("entity_id", slice)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const r of data ?? []) auditRowMap.set(r.id as string, r);
    }
  }

  // 2) Partner-specific actions (deletes/geocode) — the record may no longer
  // exist, so match on the action namespace instead of entity_id.
  {
    const { data } = await admin
      .from("audit_log")
      .select("id, actor_id, actor_email, action, entity, entity_id, summary, created_at")
      .like("action", "partner.%")
      .order("created_at", { ascending: false })
      .limit(200);
    for (const r of data ?? []) {
      if (
        r.entity_id &&
        !orgIdSet.has(r.entity_id as string) &&
        r.action !== "partner.record.delete"
      ) {
        continue;
      }
      auditRowMap.set(r.id as string, r);
    }
  }

  const auditRows = [...auditRowMap.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );

  // Resolve actor display names from app_user (falls back to email).
  const actorIds = [
    ...new Set(auditRows.map((r) => r.actor_id).filter((v): v is string => !!v)),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const { data: users } = await admin
      .from("app_user")
      .select("id, full_name")
      .in("id", actorIds);
    for (const u of users ?? []) {
      if (u.full_name) actorNames.set(u.id as string, u.full_name as string);
    }
  }
  const auditLog: OrgActivityLogEntry[] = auditRows.slice(0, 200).map((r) => ({
    id: r.id,
    actor_name: r.actor_id ? actorNames.get(r.actor_id) ?? null : null,
    actor_email: r.actor_email,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    summary: r.summary,
    created_at: r.created_at,
  }));

  // Active email templates for the partner "Send Email" (partner + general).
  const { data: templateRows } = await admin
    .from("email_template")
    .select("*")
    .eq("is_active", true)
    .in("category", ["partner", "general"])
    .order("name");
  const templates = (templateRows ?? []) as EmailTemplate[];

  return (
    <PartnerCrm
      partners={partners}
      visits={visits}
      retailLeads={retailLeads}
      auditLog={auditLog}
      canEdit={canEdit}
      mapsApiKey={mapsApiKey}
      templates={templates}
      senderName={current?.appUser.full_name ?? null}
      senderEmail={current?.email ?? null}
    />
  );
}
