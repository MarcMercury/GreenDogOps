import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFields, type RecruitingForm } from "@/lib/ats/forms";
import { positionLabel } from "@/lib/ats/types";

export interface PublicJob {
  id: string;
  label: string;
}

/** The active application form by slug, or the default one at /apply. */
export async function loadApplicationForm(slug: string | null): Promise<RecruitingForm | null> {
  const admin = createAdminClient();
  let query = admin
    .from("recruiting_form")
    .select("*")
    .eq("kind", "application")
    .eq("active", true);
  query = slug ? query.eq("slug", slug) : query.eq("is_default", true);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const form = data as RecruitingForm;
  return { ...form, fields: parseFields(form.fields) };
}

/** Open jobs a candidate can apply for. */
export async function loadOpenJobs(): Promise<PublicJob[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("position")
    .select("id, title, location")
    .eq("status", "open")
    .order("title")
    .order("location");
  return ((data ?? []) as { id: string; title: string; location: string | null }[]).map((j) => ({
    id: j.id,
    label: positionLabel(j),
  }));
}
