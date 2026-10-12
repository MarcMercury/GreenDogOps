import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule, canEditModule, isAdminRole } from "@/lib/auth/permissions";
import { scopeForUser } from "@/lib/reporting/smart-scope";
import { PageHeader } from "../_components/ui";
import { SectionCard } from "../reporting/charts";
import { SmartChat } from "./smart-chat";
import { GlossaryPanel } from "./glossary-panel";

export const dynamic = "force-dynamic";
// A question can spend 60s in smart_query plus several LLM round trips; the
// 60s default would 504 the server action mid-answer.
export const maxDuration = 300;

/** Starter questions per data scope — General users cannot query revenue. */
const GENERAL_SUGGESTIONS = [
  "When am I working next?",
  "How much PTO do I have available?",
  "Which patients have appointments at Venice tomorrow?",
  "When is Bella's next vaccine due?",
  "What does our policy say about clocking in late?",
  "How many active patients do we have by species?",
];

const FULL_SUGGESTIONS = [
  "How much revenue did we generate last month?",
  "Top 10 revenue-producing doctors this year",
  "Which location had the most appointments last month?",
  "How many active patients do we have by species?",
  "When am I working next?",
  "What does our policy say about clocking in late?",
];

export default async function AskZiggyPage() {
  const current = await getCurrentUser();

  // The (app) layout already gates /ask-ziggy on the module; this covers a
  // direct render without it.
  if (!current || !canAccessModule(current.appUser, "ask_ziggy")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="Assistant" title="Ask Ziggy" description="Ask questions in plain English." />
        <SectionCard title="Access required" description="Ask Ziggy is not available on your account.">
          <p className="text-sm text-slate-500">
            If you believe you should have it, ask an administrator to turn on Ask Ziggy for you.
          </p>
        </SectionCard>
      </div>
    );
  }

  const scope = scopeForUser(current.appUser);
  const limits = [
    scope.canViewFinancials ? null : "revenue, prices and client spending",
    scope.canViewCompensation ? null : "employee pay, wages and benefits",
    scope.canViewHrRecords ? null : "confidential employee records",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assistant"
        title="Ask Ziggy"
        description="Ask about patients, clients, appointments, the schedule, your own shifts and PTO, or company policy — answered from live data."
        actions={
          canAccessModule(current.appUser, "reporting") ? (
            <Link
              href="/reporting"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Reporting →
            </Link>
          ) : null
        }
      />
      {limits.length ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Your access level excludes {limits.join(", ")}. Questions about that data will come back
          unanswered.
        </p>
      ) : null}
      <p className="text-xs text-slate-400">
        Ziggy reports what is on record — it does not diagnose. Clinical notes, labs and imaging live
        in ezyVet and are not searchable here yet.
      </p>
      <SmartChat suggestions={scope.canViewFinancials ? FULL_SUGGESTIONS : GENERAL_SUGGESTIONS} />
      {scope.canViewFinancials ? (
        <GlossaryPanel
          canEdit={canEditModule(current.appUser, "reporting") || isAdminRole(current.appUser.role)}
        />
      ) : null}
    </div>
  );
}
