import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../../../../_components/ui";
import { boardType } from "@/lib/med-ops/types";
import { getBoardLocationBySlug } from "../../data";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ location: string; board: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ location: locationSlug, board: boardKey }, { date }] =
    await Promise.all([params, searchParams]);

  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) {
    notFound();
  }

  const board = boardType(boardKey);
  const location = await getBoardLocationBySlug(locationSlug);
  if (!board || !location) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${location.display_name ?? location.name} · Med Ops`}
        title={board.label}
        description={date ? `Workflow board for ${date}.` : "Daily workflow board."}
        actions={
          <Link
            href="/med-ops/medical-boards"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ← All boards
          </Link>
        }
      />
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
        <span className="text-3xl" aria-hidden>
          {board.icon}
        </span>
        <p className="mt-3 text-sm font-medium text-slate-700">
          The interactive {board.label.toLowerCase()} is coming soon.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          This board will auto-populate from the ezyVet Agenda for this
          department and day, with live-editable patient status, services, and
          progress tracking.
        </p>
      </div>
    </div>
  );
}
