"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { MAX_SMS_LENGTH, OPT_OUT_FOOTER } from "@/lib/sms/rules";
import { loadTexts, recordTextConsent, removeTextConsent, sendText, type TextsView } from "./sms-actions";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const primaryBtn =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const secondaryBtn =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";

const CONSENT_SOURCES = [
  "Agreed verbally",
  "Agreed in writing (text or email)",
  "Signed onboarding acknowledgement",
];

const TEMPLATES: Record<"candidate" | "employee", { label: string; text: string }[]> = {
  candidate: [
    { label: "Check your email", text: "Hi {first}, we just emailed you about your application. Please check your inbox (and spam folder)." },
    { label: "Interview reminder", text: "Hi {first}, a reminder about your interview with us. Reply here if you need to reschedule." },
    { label: "Please call us", text: "Hi {first}, please give us a call back when you have a moment about your application." },
  ],
  employee: [
    { label: "Open shift", text: "Hi {first}, we have an open shift coming up. Reply if you're available to pick it up." },
    { label: "Please call HR", text: "Hi {first}, please give HR a call when you have a moment." },
    { label: "Check your email", text: "Hi {first}, we just sent you an email. Please check your inbox when you can." },
  ],
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Sending…",
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Not delivered",
  failed: "Failed",
  received: "",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The Texts tab on candidate and employee profiles: the conversation, consent
 * and opt-out status, and a composer. Every rule is enforced again on the
 * server; the UI only explains why sending is blocked.
 */
export function SmsPanel({ personId, audience }: { personId: string; audience: "candidate" | "employee" }) {
  const [view, setView] = useState<TextsView | null>(null);
  const [body, setBody] = useState("");
  const [consentSource, setConsentSource] = useState(CONSENT_SOURCES[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => setView(await loadTexts(personId)), [personId]);

  useEffect(() => {
    let live = true;
    loadTexts(personId).then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [personId]);

  if (!view) return <p className="py-6 text-sm text-slate-500">Loading texts…</p>;
  if (!view.ok) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{view.error}</p>;
  if (!view.configured) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <p className="font-medium text-slate-800">Texting isn&apos;t set up yet.</p>
        <p className="mt-1">
          Once the Twilio number is approved and connected, you&apos;ll be able to text {audience === "candidate" ? "candidates" : "employees"} from here.
        </p>
      </div>
    );
  }

  const consentLine = view.consentRecorded
    ? `Consent recorded: ${view.consentRecorded.source} (${[
        view.consentRecorded.recorded_by_name ? `by ${view.consentRecorded.recorded_by_name}` : null,
        new Date(view.consentRecorded.consented_at).toLocaleDateString(),
      ]
        .filter(Boolean)
        .join(", ")})`
    : view.consentFromApplication
      ? "Consent: agreed to texts on their application"
      : "No texting consent on file";
  const hasConsent = Boolean(view.consentRecorded) || view.consentFromApplication;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else after?.();
      await refresh();
    });

  return (
    <div className="space-y-4">
      {!view.live && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Test mode: texts only go to the numbers in SMS_TEST_NUMBERS until texting is switched live.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
        <span>
          📱 <span className="font-medium text-slate-800">{view.phone ?? view.phoneRaw ?? "No mobile number"}</span>
        </span>
        <span className={hasConsent ? "text-emerald-700" : "text-amber-700"}>{consentLine}</span>
        {view.optedOut && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">Replied STOP</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {view.consentRecorded ? (
            <button
              type="button"
              disabled={pending}
              className={secondaryBtn}
              onClick={() => {
                if (confirm("Remove the recorded texting consent?")) run(() => removeTextConsent(personId));
              }}
            >
              Remove consent
            </button>
          ) : (
            !view.consentFromApplication && (
              <>
                <select value={consentSource} onChange={(e) => setConsentSource(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  {CONSENT_SOURCES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button type="button" disabled={pending} className={secondaryBtn} onClick={() => run(() => recordTextConsent(personId, consentSource))}>
                  Record consent
                </button>
              </>
            )
          )}
          <button type="button" disabled={pending} className={secondaryBtn} onClick={() => startTransition(refresh)}>
            ↻
          </button>
        </span>
      </div>

      <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
        {view.messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No texts yet.</p>
        ) : (
          view.messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? "bg-emerald-600 text-white" : "bg-white text-slate-800"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-[11px] ${out ? "text-emerald-100" : "text-slate-400"}`}>
                    {when(m.created_at)}
                    {out && m.sent_by_name ? ` · ${m.sent_by_name}` : ""}
                    {out && STATUS_LABEL[m.status] ? ` · ${STATUS_LABEL[m.status]}` : ""}
                  </p>
                  {m.error_message && (m.status === "failed" || m.status === "undelivered") && (
                    <p className="mt-1 text-[11px] text-rose-100">{m.error_message}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES[audience].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setBody(t.text.replace("{first}", view.firstName?.trim() || "there"))}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={MAX_SMS_LENGTH}
          placeholder="Write a text…"
          className={inputCls}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {body.trim().length}/{MAX_SMS_LENGTH} · &quot;Green Dog:&quot; is added at the start, and &quot;{OPT_OUT_FOOTER}&quot; to the first text.
          </p>
          <button
            type="button"
            disabled={pending || Boolean(view.blocked) || !body.trim()}
            onClick={() => run(() => sendText(personId, body), () => setBody(""))}
            className={primaryBtn}
          >
            {pending ? "Sending…" : "Send text"}
          </button>
        </div>
        {view.blocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{view.blocked}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
