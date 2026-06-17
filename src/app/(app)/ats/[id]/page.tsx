import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CandidateRow } from "@/lib/ats/types";
import { CandidateForm } from "./candidate-form";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, full_name, email, phone_mobile,
       phone_home, phone_other, notes,
       source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         interview_date, score, resume_url, keep_for_future, follow_up_date,
         notes, target_title, created_at, updated_at
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load candidate: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const rec = (data as { person_recruiting?: unknown }).person_recruiting;
  const row: CandidateRow = {
    ...data,
    person_recruiting: Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null),
  } as CandidateRow;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/ats" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to recruiting
      </Link>
      {row.source_contact_id && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
          <p className="text-sm font-medium text-violet-900">
            🎓 Promoted from the Student CRM
          </p>
          <Link
            href={`/crm/contact/${row.source_contact_id}`}
            className="shrink-0 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
          >
            View student record →
          </Link>
        </div>
      )}
      <CandidateForm row={row} />
    </div>
  );
}
