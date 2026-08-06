import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { boardType } from "@/lib/med-ops/types";
import { fetchBoardRow } from "../../../(app)/med-ops/medical-boards/actions";
import { getBoardLocations } from "../../../(app)/med-ops/medical-boards/data";
import { PatientWindow } from "./patient-window";

export const dynamic = "force-dynamic";

export default async function PatientWindowPage({
  params,
}: {
  params: Promise<{ row: string }>;
}) {
  const { row: rowId } = await params;

  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) notFound();

  const row = await fetchBoardRow(rowId);
  if (!row) notFound();

  const board = boardType(row.board_type);
  if (!board) notFound();

  const locations = await getBoardLocations();
  const location = locations.find((l) => l.id === row.location_id) ?? null;

  return (
    <PatientWindow
      row={row}
      board={board}
      locationName={location?.display_name ?? location?.name ?? ""}
    />
  );
}
