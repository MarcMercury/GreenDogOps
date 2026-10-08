"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { INTERVIEW_TYPE_LABELS } from "@/lib/ats/types";
import { formMatchesTitle } from "@/lib/ats/forms";
import { sendFormToCandidate } from "./forms-actions";
import { previewInviteSlots, sendSchedulingInvite, type InviteInput } from "./scheduling-actions";

export interface ScreeningFormOption {
  id: string;
  name: string;
  job_titles: string[];
}

export interface InterviewerOption {
  user_id: string;
  name: string;
  /** Has weekly availability and is active. */
  bookable: boolean;
  google_connected: boolean;
  default_duration: number;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-500";
const primaryBtn =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const secondaryBtn =
  "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full space-y-5 overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5 sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** After sending: emailed ✓ or the link to copy. */
function SentLink({
  url,
  emailed,
  warning,
  what,
  onDone,
}: {
  url: string;
  emailed: boolean;
  warning?: string;
  what: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <p
        className={`rounded-lg px-3 py-2 text-sm ${
          emailed ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
        }`}
      >
        {emailed ? `✅ ${what} emailed to the candidate.` : `⚠️ ${warning ?? "Not emailed."}`}
      </p>
      <div>
        <span className={labelCls}>Their unique link</span>
        <div className="flex gap-2">
          <input readOnly value={url} className={`${inputCls} text-xs`} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
            className={secondaryBtn}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={onDone} className={primaryBtn}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Pick a role-specific form and send it. */
export function SendFormPanel({
  personId,
  forms,
  jobTitle,
  onDone,
  onBack,
}: {
  personId: string;
  forms: ScreeningFormOption[];
  jobTitle: string | null;
  onDone: () => void;
  onBack?: () => void;
}) {
  const sorted = [...forms].sort(
    (a, b) =>
      Number(formMatchesTitle(b, jobTitle)) - Number(formMatchesTitle(a, jobTitle)) ||
      a.name.localeCompare(b.name),
  );
  const [formId, setFormId] = useState(sorted[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ url: string; emailed: boolean; warning?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) return <SentLink {...sent} what="Questionnaire" onDone={onDone} />;
  if (sorted.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          There are no active role-specific forms yet. Create one on the{" "}
          <Link href="/ats?tab=forms" className="font-medium text-emerald-700 hover:underline">
            Forms tab
          </Link>
          .
        </p>
        <div className="flex justify-end gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className={secondaryBtn}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <label className="block">
        <span className={labelCls}>Form</span>
        <select value={formId} onChange={(e) => setFormId(e.target.value)} className={inputCls}>
          {sorted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {formMatchesTitle(f, jobTitle) ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        The candidate gets an email with their own link. Their answers attach to the Forms tab on their profile,
        and both steps post in their Slack thread.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className={secondaryBtn}>
            Back
          </button>
        )}
        <button
          type="button"
          disabled={!formId || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await sendFormToCandidate(personId, formId);
              if (res.ok) setSent(res);
              else setError(res.error);
            })
          }
          className={primaryBtn}
        >
          {pending ? "Sending…" : "Send to Candidate"}
        </button>
      </div>
    </div>
  );
}

const DURATIONS = [15, 20, 30, 45, 60, 90, 120];

/** Choose the interview details and send a "pick a time" link. */
export function ScheduleInvitePanel({
  personId,
  interviewers,
  currentUserId,
  defaultType = "phone_screen",
  defaultLocation,
  onDone,
  onBack,
}: {
  personId: string;
  interviewers: InterviewerOption[];
  currentUserId: string | null;
  defaultType?: string;
  defaultLocation?: string | null;
  onDone: () => void;
  onBack?: () => void;
}) {
  const me = interviewers.find((i) => i.user_id === currentUserId) ?? null;
  const [mode, setMode] = useState<"me" | "person">(me ? "me" : "person");
  const others = interviewers.filter((i) => i.user_id !== currentUserId);
  const [personPick, setPersonPick] = useState(
    (others.find((i) => i.bookable) ?? others[0])?.user_id ?? "",
  );
  const hostId = mode === "me" ? (me?.user_id ?? "") : personPick;
  const host = interviewers.find((i) => i.user_id === hostId) ?? null;

  const [type, setType] = useState(defaultType);
  const [duration, setDuration] = useState(host?.default_duration ?? 30);
  const [dateFrom, setDateFrom] = useState(localDate(0));
  const [dateTo, setDateTo] = useState(localDate(7));
  const phoneDefault = "Phone call — we'll call the number on your application.";
  const [location, setLocation] = useState(
    defaultType === "phone_screen" ? phoneDefault : (defaultLocation ?? ""),
  );
  const [message, setMessage] = useState("");
  const [previewResult, setPreviewResult] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ url: string; emailed: boolean; warning?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const input: InviteInput = {
    interviewType: type,
    hostUserId: hostId,
    durationMinutes: duration,
    dateFrom,
    dateTo,
    location: location || null,
    message: message || null,
  };

  const previewKey = [hostId, type, duration, dateFrom, dateTo].join("|");
  const canPreview = Boolean(hostId && host?.bookable);
  const preview = !canPreview
    ? null
    : previewResult?.key === previewKey
      ? previewResult.text
      : "Checking open times…";

  useEffect(() => {
    if (!canPreview) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await previewInviteSlots({
        interviewType: type,
        hostUserId: hostId,
        durationMinutes: duration,
        dateFrom,
        dateTo,
        location: null,
        message: null,
      });
      if (!live) return;
      setPreviewResult({
        key: previewKey,
        text: res.ok
          ? res.count === 0
            ? "⚠️ No open times in this range."
            : `✅ ${res.count} open time${res.count === 1 ? "" : "s"} · first: ${res.first}`
          : `⚠️ ${res.error}`,
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [canPreview, previewKey, hostId, type, duration, dateFrom, dateTo]);

  if (sent) return <SentLink {...sent} what="Scheduling link" onDone={onDone} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Interview type</span>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value;
              setType(next);
              if (next === "phone_screen" && !location) setLocation(phoneDefault);
              if (next !== "phone_screen" && location === phoneDefault) setLocation(defaultLocation ?? "");
            }}
            className={inputCls}
          >
            {Object.entries(INTERVIEW_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Duration</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
            {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className={labelCls}>Interview with</legend>
        <div className="space-y-1.5 text-sm text-slate-700">
          <label className={`flex items-center gap-2 ${me ? "" : "opacity-50"}`}>
            <input type="radio" checked={mode === "me"} disabled={!me} onChange={() => setMode("me")} className="h-4 w-4 text-emerald-600" />
            Me{me && !me.bookable && <span className="text-xs text-amber-700">— set your availability first</span>}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "person"} onChange={() => setMode("person")} className="h-4 w-4 text-emerald-600" />
            Specific person
          </label>
          {mode === "person" && (
            <select value={personPick} onChange={(e) => setPersonPick(e.target.value)} className={`${inputCls} ml-6 w-[calc(100%-1.5rem)]`}>
              {others.map((i) => (
                <option key={i.user_id} value={i.user_id} disabled={!i.bookable}>
                  {i.name}
                  {i.bookable ? (i.google_connected ? "" : " (no calendar connected)") : " — no availability set"}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 opacity-50" title="Coming in Phase 2">
            <input type="radio" disabled className="h-4 w-4" />
            Recruiting team <span className="text-xs">(coming soon)</span>
          </label>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Available from</span>
          <input type="date" value={dateFrom} min={localDate(0)} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Through</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Where (shown to the candidate)</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="Phone call, Zoom link, or clinic address" />
      </label>
      <label className="block">
        <span className={labelCls}>Message (optional)</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={inputCls} />
      </label>

      {host && !host.bookable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {host.user_id === currentUserId ? (
            <>
              Set your weekly hours on{" "}
              <Link href="/ats/availability" className="font-medium underline">
                My Availability
              </Link>{" "}
              first.
            </>
          ) : (
            `${host.name} hasn't set their availability yet.`
          )}
        </p>
      )}
      {preview && <p className="text-sm text-slate-600">{preview}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className={secondaryBtn}>
            Back
          </button>
        )}
        <button
          type="button"
          disabled={pending || !host?.bookable}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await sendSchedulingInvite(personId, input);
              if (res.ok) setSent(res);
              else setError(res.error);
            })
          }
          className={primaryBtn}
        >
          {pending ? "Sending…" : "Send Scheduling Link"}
        </button>
      </div>
    </div>
  );
}

export function SendFormDialog(props: {
  personId: string;
  candidateName: string;
  forms: ScreeningFormOption[];
  jobTitle: string | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Send a form" subtitle={props.candidateName} onClose={props.onClose}>
      <SendFormPanel personId={props.personId} forms={props.forms} jobTitle={props.jobTitle} onDone={props.onClose} />
    </Modal>
  );
}

export function ScheduleInviteDialog(props: {
  personId: string;
  candidateName: string;
  interviewers: InterviewerOption[];
  currentUserId: string | null;
  defaultType?: string;
  defaultLocation?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Invite to schedule" subtitle={props.candidateName} onClose={props.onClose}>
      <ScheduleInvitePanel {...props} onDone={props.onClose} />
    </Modal>
  );
}

/**
 * Shown right after a recruiter approves an applicant: send a role-specific
 * form, invite them to book a phone interview, or just move on.
 */
export function ApprovedNextStepDialog({
  personId,
  candidateName,
  jobTitle,
  forms,
  interviewers,
  currentUserId,
  defaultLocation = null,
  onClose,
}: {
  personId: string;
  candidateName: string;
  jobTitle: string | null;
  defaultLocation?: string | null;
  forms: ScreeningFormOption[];
  interviewers: InterviewerOption[];
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"choose" | "form" | "phone" | "in_person">("choose");
  return (
    <Modal
      title={
        step === "choose"
          ? "Candidate Approved — Next Step"
          : step === "form"
            ? "Send Additional Form"
            : step === "phone"
              ? "Schedule Phone Interview"
              : "Schedule In-Person Interview"
      }
      subtitle={candidateName}
      onClose={onClose}
    >
      {step === "choose" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">What&apos;s next for this candidate?</p>
          <button type="button" onClick={() => setStep("form")} className={`${primaryBtn} w-full py-3`}>
            📝 Send Additional Form
          </button>
          <button
            type="button"
            onClick={() => setStep("phone")}
            className="w-full rounded-lg border border-emerald-600 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
          >
            📞 Schedule Phone Interview
          </button>
          <button
            type="button"
            onClick={() => setStep("in_person")}
            className="w-full rounded-lg border border-violet-600 px-4 py-3 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
          >
            👋 Schedule In-Person Interview
          </button>
          <button type="button" onClick={onClose} className={`${secondaryBtn} w-full py-3`}>
            Skip &amp; Continue
          </button>
        </div>
      )}
      {step === "form" && (
        <SendFormPanel personId={personId} forms={forms} jobTitle={jobTitle} onDone={onClose} onBack={() => setStep("choose")} />
      )}
      {(step === "phone" || step === "in_person") && (
        <ScheduleInvitePanel
          key={step}
          personId={personId}
          interviewers={interviewers}
          currentUserId={currentUserId}
          defaultType={step === "phone" ? "phone_screen" : "in_person"}
          defaultLocation={defaultLocation}
          onDone={onClose}
          onBack={() => setStep("choose")}
        />
      )}
    </Modal>
  );
}
