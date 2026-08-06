import { PageHeader } from "../../_components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { boardType, locationSlug } from "@/lib/med-ops/types";
import {
  getBoardDay,
  getBoardLocations,
  getBoardRows,
  getBoardTypes,
} from "../medical-boards/data";
import { ArchivePicker } from "./archive-picker";
import { ArchivedBoard } from "./archived-board";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function BoardArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; location?: string; board?: string }>;
}) {
  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="Med Ops" title="Board Archive" />
        <p className="text-sm text-slate-500">
          You don&apos;t have access to Medical Boards.
        </p>
      </div>
    );
  }

  const { date, location: locParam, board: boardParam } = await searchParams;
  const [locations, boardTypes] = await Promise.all([
    getBoardLocations(),
    getBoardTypes(),
  ]);

  const selectedDate = date && ISO_DATE.test(date) ? date : null;
  const location =
    locations.find((l) => locationSlug(l) === locParam?.toLowerCase()) ?? null;
  const board = boardType(boardParam, boardTypes);

  const ready = Boolean(selectedDate && location && board);
  const [rows, day] = ready
    ? await Promise.all([
        getBoardRows(location!.id, selectedDate!, board!.key),
        getBoardDay(location!.id, selectedDate!, board!.key),
      ])
    : [[], null];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Med Ops"
        title="Board Archive"
        description="Look up any past board exactly as it stood at the end of that day."
      />

      <ArchivePicker
        locations={locations.map((l) => ({
          slug: locationSlug(l),
          label: l.display_name ?? l.name,
        }))}
        boards={boardTypes.map((b) => ({ key: b.key, label: b.label }))}
        date={selectedDate ?? ""}
        location={location ? locationSlug(location) : ""}
        board={board?.key ?? ""}
      />

      {!ready ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
          <p className="text-sm text-slate-600">
            Choose a date, location and department to view that day&apos;s board.
          </p>
        </div>
      ) : (
        <ArchivedBoard
          rows={rows}
          board={board!}
          locationName={location!.display_name ?? location!.name}
          date={selectedDate!}
          status={day?.status ?? null}
        />
      )}
    </div>
  );
}
