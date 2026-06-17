"use client";

import {
  OPPORTUNITY_GROUPS,
  OPPORTUNITY_TYPES,
  opportunityShortLabel,
  opportunityType,
} from "@/lib/shared/opportunity-types";

/**
 * Labeled <select> for a person's Opportunity Type — the nature of their
 * engagement with Green Dog. Shared by the Student CRM, ATS, and HR forms so
 * the value follows a person from visitor/student -> applicant -> employee.
 *
 * Renders as a single grid cell matching the surrounding form sections.
 */
export function OpportunityTypeField({
  label = "Opportunity type",
  name = "opportunity_type",
  defaultValue,
  className,
}: {
  label?: string;
  name?: string;
  defaultValue?: string | null;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {OPPORTUNITY_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {OPPORTUNITY_TYPES.filter((o) => o.group === group).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/**
 * Compact badge for a person's Opportunity Type, for list/table cells.
 * Paid engagements are emerald; unpaid are slate. Returns "—" when unset.
 */
export function OpportunityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const def = opportunityType(value);
  const tone = def?.paid
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {opportunityShortLabel(value)}
    </span>
  );
}
