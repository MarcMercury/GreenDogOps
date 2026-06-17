import { createClient } from "@/lib/supabase/server";
import type { CandidateRow } from "@/lib/ats/types";
import { AtsExplorer } from "./ats-explorer";

export const dynamic = "force-dynamic";

export default async function AtsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, full_name, email, phone_mobile,
     phone_home, phone_other, opportunity_type, notes,
       source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         interview_date, score, resume_url, keep_for_future, follow_up_date,
         notes, target_title, created_at, updated_at
       )`,
    )
    .eq("status", "applicant")
    .order("last_name", { ascending: true })
    .limit(5000);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Recruiting (ATS)</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load candidates: {error.message}
        </p>
      </div>
    );
  }

  const rows: CandidateRow[] = (data ?? []).map((r) => {
    const rec = (r as { person_recruiting?: unknown }).person_recruiting;
    return {
      ...r,
      person_recruiting: Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null),
    } as CandidateRow;
  });

  return <AtsExplorer rows={rows} />;
}
