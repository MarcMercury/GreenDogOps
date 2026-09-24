"use client";

import { useMemo, useState } from "react";
import type { CrmInfluencer } from "@/lib/crm/types";
import type { QrCode, QrLead } from "@/lib/marketing/qr";
import { QrLeadsView, buildQrLeadRows } from "@/lib/marketing/qr-leads-view";
import { InfluencerListView, influencerDisplayName } from "../crm-views";

export function InfluencerWorkspace({
  influencers,
  qrCodes,
  qrLeads,
  canEdit,
}: {
  influencers: CrmInfluencer[];
  qrCodes: QrCode[];
  qrLeads: QrLead[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<"list" | "leads">("list");

  const leadRows = useMemo(() => {
    const codeIds = new Set(qrCodes.map((c) => c.id));
    return buildQrLeadRows(
      qrLeads.filter((l) => codeIds.has(l.qr_code_id)),
      qrCodes,
      new Map(influencers.map((i) => [i.id, influencerDisplayName(i)])),
    );
  }, [qrLeads, qrCodes, influencers]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {(["list", "leads"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
              tab === t
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t === "list" ? "Influencers" : `Leads (${leadRows.length})`}
          </button>
        ))}
      </div>

      {tab === "leads" ? (
        <QrLeadsView
          rows={leadRows}
          canEdit={canEdit}
          sourceLabel="Influencer"
          exportName="influencer-leads"
          emptyHint="No influencer leads yet. Open an influencer and share the QR code on their profile — every scan is attributed back to them here."
        />
      ) : (
        <InfluencerListView influencers={influencers} addHref="/crm/influencer/new" />
      )}
    </div>
  );
}