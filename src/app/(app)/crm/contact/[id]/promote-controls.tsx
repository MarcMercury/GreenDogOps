"use client";

import { useTransition } from "react";
import { promoteStudentToRecruiting } from "../../actions";

export function PromoteToRecruiting({ contactId }: { contactId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">
          Move into the Recruiting CRM
        </p>
        <p className="text-xs text-blue-700">
          Creates a candidate record from this student. Their details carry over
          and this student record stays linked.
        </p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            confirm(
              "Promote this student into the Recruiting CRM? They will become a candidate (applicant).",
            )
          ) {
            startTransition(() => promoteStudentToRecruiting(contactId));
          }
        }}
        className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Promoting…" : "Promote to Recruiting →"}
      </button>
    </div>
  );
}
