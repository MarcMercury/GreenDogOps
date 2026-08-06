import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../../../../_components/ui";
import { boardType, locationSlug } from "@/lib/med-ops/types";
import { getBoardLocationBySlug, getBoardRows, seedBoard } from "../../data";
import { MedicalBoard } from "./medical-board";

export const dynamic = "force-dynamic";

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ location: string; board: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ location: slug, board: boardKey }, { date: dateParam }] =
    await Promise.all([params, searchParams]);

  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) {
    notFound();
  }

  const board = boardType(boardKey);
  const location = await getBoardLocationBySlug(slug);
  if (!board || !location) notFound();

  const date = dateParam && ISO_DATE.test(dateParam) ? dateParam : todayLA();

  // Opening the board pulls in any appointment not on it yet; insert-only, so
  // it is safe on every visit and never disturbs work already recorded.
  await seedBoard(location.id, date, board.key);
  const rows = await getBoardRows(location.id, date, board.key);

  const pretty = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Med Ops · ${location.display_name ?? location.name}`}
        title={board.label}
        description={pretty}
        actions={
          <Link
            href="/med-ops/medical-boards"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ← All boards
          </Link>
        }
      />
      <MedicalBoard
        key={`${location.id}:${date}:${board.key}`}
        board={board}
        locationId={location.id}
        locationSlug={locationSlug(location)}
        date={date}
        initialRows={rows}
      />
    </div>
  );
}
