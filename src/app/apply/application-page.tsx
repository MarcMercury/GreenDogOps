import { notFound } from "next/navigation";
import { PublicShell } from "@/lib/ats/public-shell";
import { loadApplicationForm, loadOpenJobs } from "./load";
import { ApplicationForm } from "./application-form";

/** The Standard Application, shared by /apply and /apply/<slug>. */
export async function ApplicationPage({
  slug,
  searchParams,
}: {
  slug: string | null;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [form, jobs] = await Promise.all([loadApplicationForm(slug), loadOpenJobs()]);
  if (!form) notFound();
  const param = (k: string) => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const jobId = param("job");
  return (
    <PublicShell title={form.name} intro={form.intro}>
      <ApplicationForm
        formId={form.id}
        fields={form.fields}
        jobs={jobs}
        requireResume={form.require_resume}
        successMessage={form.success_message}
        defaultJobId={jobId && jobs.some((j) => j.id === jobId) ? jobId : null}
        source={param("source")}
      />
    </PublicShell>
  );
}
