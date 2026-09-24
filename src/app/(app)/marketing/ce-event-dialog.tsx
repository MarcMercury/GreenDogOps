"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CeEventSummary } from "@/lib/marketing/event-rows";
import { ceStatusToEventStatus } from "@/lib/marketing/event-rows";
import type { QrCode, QrForm } from "@/lib/marketing/qr";
import { eventStatusLabel } from "@/lib/marketing/types";
import { QrPanel } from "@/lib/marketing/qr-panel";

const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

function fmtDate(d: string | null): string {
  if (!d) return "Date TBD";
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return t;
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m ?? "00"} ${ampm}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * CE courses are read-only here on purpose: the course itself (RACE approval,
 * credit hours, CE Broker submission, itinerary) is developed in the CE module.
 * Event Management shows it so it appears wherever events appear, and owns the
 * one thing it was missing — the QR code and its capture form.
 */
export function CeEventDialog({
  event,
  qrCodes,
  qrForms,
  canEdit,
  onClose,
}: {
  event: CeEventSummary;
  qrCodes: QrCode[];
  qrForms: QrForm[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"details" | "qr">("details");

  const codes = useMemo(
    () => qrCodes.filter((c) => c.ce_event_id === event.id),
    [qrCodes, event.id],
  );

  const dateText =
    event.end_date && event.end_date !== event.event_date
      ? `${fmtDate(event.event_date)} – ${fmtDate(event.end_date)}`
      : fmtDate(event.event_date);
  const timeText = [fmtTime(event.start_time), fmtTime(event.end_time)]
    .filter(Boolean)
    .join(" – ");

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                CE course
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {eventStatusLabel(ceStatusToEventStatus(event.status))}
              </span>
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-slate-900">{event.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/crm/ce" className={btnGhost}>
              Open in CE module →
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-5 pt-2">
          {([
            { key: "details", label: "Details" },
            { key: "qr", label: "QR code" },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-5 py-4">
          {tab === "details" ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                CE courses are built in the CE module — RACE approval, credit hours,
                itinerary and the CE Broker submission all live there. This view is
                read-only so the two never drift.
              </p>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Row label="Dates" value={dateText} />
                <Row label="Time" value={timeText || "—"} />
                <Row label="Location" value={event.location} />
                <Row label="Subject" value={event.subject} />
                <Row label="Presenters" value={event.presenters} />
                <Row label="Audience" value={event.audience} />
                <Row label="Capacity" value={event.capacity ?? "—"} />
                <Row
                  label="Cost"
                  value={
                    event.cost_type === "paid"
                      ? event.cost_amount != null
                        ? `$${event.cost_amount}`
                        : "Paid"
                      : "Free"
                  }
                />
                <Row label="CE hours" value={event.ce_hours_total ?? "—"} />
                <Row label="Approval board" value={event.approval_board} />
                <Row
                  label="Approval"
                  value={
                    event.race_approved ? "RACE approved" : event.approval_status ?? "—"
                  }
                />
                <Row
                  label="Registration"
                  value={
                    event.registration_url ? (
                      <a
                        href={event.registration_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
              </dl>
              {event.description && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {event.description}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <QrPanel
              subject={{ kind: "ce", id: event.id, name: event.name }}
              codes={codes}
              forms={qrForms}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
