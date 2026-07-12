import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { CandidateRow, CandidateInterviewMeta } from "@/lib/ats/types";
import { AtsExplorer } from "./ats-explorer";

export const dynamic = "force-dynamic";

export default async function AtsPage() {
  const supabase = await createClient();

  const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("person")
      .select(
        `id, status, first_name, last_name, full_name, email, phone_mobile,
     phone_home, phone_other, opportunity_type, notes,
       source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         application_date, interview_date, score, resume_url, keep_for_future,
         follow_up_date, notes, target_title, review_status, reviewed_at,
         reviewed_by, created_at, updated_at
       )`,
      )
      .eq("status", "applicant")
      .order("last_name", { ascending: true })
      .range(from, to),
  );

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

  // Roll up interviews per candidate for the pipeline list (next scheduled
  // date + most recent grade).
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    // Chunk the id list so neither the IN(...) URL nor the response exceeds
    // PostgREST limits (max_rows is 1000 per page).
    const ivData: {
      person_id: string;
      interview_date: string | null;
      status: string | null;
      overall_grade: string | null;
      created_at: string;
    }[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: page } = await fetchAllRows<(typeof ivData)[number]>(
        (from, to) =>
          supabase
            .from("person_interview")
            .select(
              "person_id, interview_date, status, overall_grade, created_at",
            )
            .in("person_id", chunk)
            .range(from, to),
      );
      ivData.push(...page);
    }

    if (ivData.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      type IvRow = {
        person_id: string;
        interview_date: string | null;
        status: string | null;
        overall_grade: string | null;
        created_at: string;
      };
      const byPerson = new Map<string, IvRow[]>();
      for (const iv of ivData as IvRow[]) {
        const list = byPerson.get(iv.person_id) ?? [];
        list.push(iv);
        byPerson.set(iv.person_id, list);
      }

      const metaByPerson = new Map<string, CandidateInterviewMeta>();
      for (const [personId, list] of byPerson) {
        let nextDate: string | null = null;
        for (const iv of list) {
          if (
            iv.status === "scheduled" &&
            iv.interview_date &&
            iv.interview_date >= today &&
            (nextDate === null || iv.interview_date < nextDate)
          ) {
            nextDate = iv.interview_date;
          }
        }

        const graded = list
          .filter((iv) => iv.overall_grade)
          .sort((a, b) => {
            const ad = a.interview_date ?? a.created_at;
            const bd = b.interview_date ?? b.created_at;
            return bd.localeCompare(ad);
          });

        metaByPerson.set(personId, {
          count: list.length,
          next_date: nextDate,
          last_grade: graded[0]?.overall_grade ?? null,
        });
      }

      for (const r of rows) {
        r.interview_meta = metaByPerson.get(r.id) ?? null;
      }
    }
  }

  return <AtsExplorer rows={rows} />;
}
