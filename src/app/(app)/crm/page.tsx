import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  CRM_SECTIONS,
  type OrgType,
  type ContactType,
} from "@/lib/crm/types";
import { PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

export default async function CrmHubPage() {
  const supabase = await createClient();

  const [orgRes, contactRes] = await Promise.all([
    supabase.from("crm_organization").select("org_type"),
    supabase.from("crm_contact").select("contact_type"),
  ]);

  const influencerRes = await supabase
    .from("marketing_influencers")
    .select("id", { count: "exact", head: true });
  const influencerCount = influencerRes.count ?? 0;

  const orgCounts: Record<string, number> = {};
  for (const o of (orgRes.data ?? []) as { org_type: OrgType }[]) {
    orgCounts[o.org_type] = (orgCounts[o.org_type] ?? 0) + 1;
  }
  const contactCounts: Record<string, number> = {};
  for (const c of (contactRes.data ?? []) as { contact_type: ContactType }[]) {
    contactCounts[c.contact_type] = (contactCounts[c.contact_type] ?? 0) + 1;
  }

  function sectionCount(slug: string): number {
    const section = CRM_SECTIONS.find((s) => s.slug === slug);
    if (!section) return 0;
    if (section.entity === "influencer") return influencerCount;
    if (section.entity === "organization") {
      return (section.orgTypes ?? []).reduce(
        (n, t) => n + (orgCounts[t] ?? 0),
        0,
      );
    }
    return (section.contactTypes ?? []).reduce(
      (n, t) => n + (contactCounts[t] ?? 0),
      0,
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="CRM"
        title="Customer Relationships"
        description="Each relationship type has its own dedicated CRM. Choose one to get started."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CRM_SECTIONS.map((s) => (
          <Link
            key={s.slug}
            href={`/crm/${s.slug}`}
            className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-md hover:shadow-emerald-600/5"
          >
            <div className="relative flex items-start justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-xl ring-1 ring-inset ring-emerald-200/70">
                {s.icon}
              </span>
              <span className="text-2xl font-bold text-slate-300">
                {sectionCount(s.slug)}
              </span>
            </div>
            <h2 className="relative mt-4 font-semibold text-slate-900">
              {s.title}
            </h2>
            <p className="relative mt-1.5 text-sm leading-relaxed text-slate-500">
              {s.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
