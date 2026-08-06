import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import type { AnimalImportRow } from "@/lib/reporting/types";
import { PageHeader } from "../../_components/ui";
import { StatCard, SectionCard, fmtNumber, fmtDate } from "../../reporting/charts";
import { PatientSearch } from "./patient-search";
import { PatientsTable } from "./patients-table";
import { PATIENT_SELECT, type PatientRow } from "./columns";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface AnimalSummary {
  total_animals: number | null;
  active_animals: number | null;
  deceased_animals: number | null;
  owners: number | null;
}

export default async function EzyvetPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; species?: string; page?: string }>;
}) {
  const { q, filter, species, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "ezyvet")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Veterinary CRM"
          title="ezyVet Patients"
          description="The full patient roster from ezyVet."
        />
        <SectionCard
          title="Access required"
          description="You do not have access to the ezyVet workspace."
        >
          <p className="text-sm text-slate-500">Ask an administrator to grant you access.</p>
        </SectionCard>
      </div>
    );
  }

  const supabase = await createClient();

  let query = supabase.from("ezyvet_animal").select(PATIENT_SELECT, { count: "exact" });

  if (q && q.trim()) {
    const term = q.trim().replace(/[,()%*]/g, " ");
    query = query.or(
      [
        `animal_name.ilike.%${term}%`,
        `animal_code.ilike.%${term}%`,
        `breed.ilike.%${term}%`,
        `microchip_number.ilike.%${term}%`,
        `owner_full_name.ilike.%${term}%`,
        `owner_business_name.ilike.%${term}%`,
      ].join(","),
    );
  }
  if (filter === "active") query = query.eq("is_active", true);
  if (filter === "deceased") query = query.eq("has_passed_away", true);
  if (species) query = query.eq("species", species);

  const from = (page - 1) * PAGE_SIZE;

  const [patientsRes, summaryRes, speciesRes, importsRes] = await Promise.all([
    query
      .order("animal_name", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1),
    supabase.from("report_animal_summary").select("*").maybeSingle(),
    supabase.from("report_animals_by_species").select("species, patients"),
    supabase
      .from("ezyvet_animal_import")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const patients = (patientsRes.data ?? []) as unknown as PatientRow[];
  const total = patientsRes.count ?? 0;
  const summary = (summaryRes.data as AnimalSummary | null) ?? null;
  const speciesList = ((speciesRes.data ?? []) as { species: string | null }[])
    .map((s) => s.species)
    .filter((s): s is string => !!s);
  const imports = (importsRes.data ?? []) as AnimalImportRow[];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (filter) sp.set("filter", filter);
    if (species) sp.set("species", species);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/ezyvet/patients?${s}` : "/ezyvet/patients";
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <PageHeader
        eyebrow="Veterinary CRM"
        title="ezyVet Patients"
        description="Every patient record from the ezyVet “Animals” report, refreshed by the nightly agent. Scroll sideways for the full set of report columns."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Patients" value={fmtNumber(summary?.total_animals)} />
        <StatCard label="Active" value={fmtNumber(summary?.active_animals)} accent="indigo" />
        <StatCard label="Deceased" value={fmtNumber(summary?.deceased_animals)} accent="sky" />
        <StatCard label="Owners" value={fmtNumber(summary?.owners)} />
      </div>

      <SectionCard
        title="Patient list"
        description={`${fmtNumber(total)} matching ${total === 1 ? "patient" : "patients"}`}
      >
        <div className="space-y-3">
          <PatientSearch species={speciesList} />
          <PatientsTable patients={patients} />
          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {page} of {fmtNumber(totalPages)}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 transition hover:bg-slate-50"
                  >
                    Previous
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 transition hover:bg-slate-50"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Sync history" description="Nightly ezyVet “Animals” report imports.">
        {imports.length === 0 ? (
          <p className="text-sm text-slate-400">No imports yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-3 font-semibold">Imported</th>
                <th className="py-2 pr-3 font-semibold">Snapshot</th>
                <th className="py-2 pr-3 text-right font-semibold">Rows</th>
                <th className="py-2 pr-3 text-right font-semibold">New</th>
                <th className="py-2 pr-3 text-right font-semibold">Updated</th>
                <th className="py-2 pr-3 text-right font-semibold">Unchanged</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 text-slate-600">{fmtDate(imp.created_at)}</td>
                  <td className="py-2 pr-3 text-slate-500">{imp.snapshot_date ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{fmtNumber(imp.total_rows)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-600">{fmtNumber(imp.new_animals)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{fmtNumber(imp.updated_animals)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-400">{fmtNumber(imp.unchanged_animals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
