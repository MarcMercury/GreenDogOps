"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FORM_KIND_LABELS, type FormKind } from "@/lib/ats/forms";
import { duplicateForm, setDefaultApplication, setFormActive } from "./forms-actions";

export interface FormListRow {
  id: string;
  kind: FormKind;
  name: string;
  description: string | null;
  job_titles: string[];
  slug: string | null;
  is_default: boolean;
  active: boolean;
  updated_at: string;
  question_count: number;
  response_count: number;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The Forms tab — the team's recruiting Google Forms: the public Standard
 * Application(s) and the role-specific questionnaires sent after approval.
 */
export function FormsList({
  forms,
  origin,
  canEdit,
}: {
  forms: FormListRow[];
  origin: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string; id?: string }>) => {
    setBusy(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else if (res.id && res.id !== id) router.push(`/ats/forms/${res.id}`);
      else router.refresh();
      setBusy(null);
    });
  };

  const applyUrl = (f: FormListRow) => (f.is_default ? `${origin}/apply` : `${origin}/apply/${f.slug}`);
  const copy = async (f: FormListRow) => {
    await navigator.clipboard.writeText(applyUrl(f));
    setCopied(f.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const groups: { kind: FormKind; title: string; hint: string }[] = [
    {
      kind: "application",
      title: "Standard Application",
      hint: "The public application linked from every job posting. Submissions land in the Review Queue.",
    },
    {
      kind: "screening",
      title: "Role-specific forms",
      hint: "Questionnaires you send a candidate after approving them. Answers attach to their profile.",
    },
  ];

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {groups.map((g) => {
        const rows = forms.filter((f) => f.kind === g.kind);
        return (
          <section key={g.kind}>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g.title}</h2>
                <p className="text-xs text-slate-400">{g.hint}</p>
              </div>
              {canEdit && (
                <Link
                  href={`/ats/forms/new?kind=${g.kind}`}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
                >
                  + {g.kind === "application" ? "Application" : "Form"}
                </Link>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No {g.kind === "application" ? "application forms" : "role-specific forms"} yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Form</th>
                      <th className="px-4 py-2.5">Used for</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-center">Responses</th>
                      <th className="px-4 py-2.5">Updated</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((f) => (
                      <tr key={f.id} className={`align-top ${f.active ? "" : "bg-slate-50/60"}`}>
                        <td className="px-4 py-3">
                          <Link href={`/ats/forms/${f.id}`} className="font-medium text-slate-900 hover:text-emerald-700">
                            {f.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {FORM_KIND_LABELS[f.kind]} · {f.question_count} question{f.question_count === 1 ? "" : "s"}
                            {f.kind === "application" && " + built-in contact & resume"}
                          </div>
                          {f.kind === "application" && f.active && (
                            <button
                              type="button"
                              onClick={() => copy(f)}
                              className="mt-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                              title={applyUrl(f)}
                            >
                              {copied === f.id ? "Copied ✓" : `🔗 Copy link (${f.is_default ? "/apply" : `/apply/${f.slug}`})`}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {f.job_titles.length ? (
                            <div className="flex flex-wrap gap-1">
                              {f.job_titles.map((t) => (
                                <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Any job</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                f.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {f.active ? "Active" : "Inactive"}
                            </span>
                            {f.is_default && (
                              <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                                Default · /apply
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums">{f.response_count}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(f.updated_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs font-medium">
                            <Link href={`/ats/forms/${f.id}/preview`} target="_blank" className="text-slate-600 hover:text-slate-900">
                              Preview
                            </Link>
                            {canEdit && (
                              <>
                                <Link href={`/ats/forms/${f.id}`} className="text-emerald-700 hover:text-emerald-900">
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  disabled={pending && busy === f.id}
                                  onClick={() => run(f.id, () => duplicateForm(f.id))}
                                  className="text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                                >
                                  Duplicate
                                </button>
                                {!f.is_default && (
                                  <button
                                    type="button"
                                    disabled={pending && busy === f.id}
                                    onClick={() => run(f.id, () => setFormActive(f.id, !f.active))}
                                    className="text-slate-600 hover:text-slate-900 disabled:opacity-50"
                                  >
                                    {f.active ? "Deactivate" : "Activate"}
                                  </button>
                                )}
                                {f.kind === "application" && !f.is_default && (
                                  <button
                                    type="button"
                                    disabled={pending && busy === f.id}
                                    onClick={() => {
                                      if (confirm(`Serve “${f.name}” at /apply instead of the current default?`)) {
                                        run(f.id, () => setDefaultApplication(f.id));
                                      }
                                    }}
                                    className="text-sky-700 hover:text-sky-900 disabled:opacity-50"
                                  >
                                    Make default
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
