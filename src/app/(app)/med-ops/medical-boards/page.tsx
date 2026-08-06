import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../../_components/ui";
import { locationSlug } from "@/lib/med-ops/types";
import { getBoardCoverage, getBoardLocations, getBoardTypes } from "./data";

export const dynamic = "force-dynamic";

/** Today in America/Los_Angeles as YYYY-MM-DD, for default board links. */
function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function MedicalBoardsPage() {
  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Med Ops"
          title="Medical Boards"
          description="Daily department workflow boards."
        />
        <p className="text-sm text-slate-500">
          You don&apos;t have access to Medical Boards.
        </p>
      </div>
    );
  }

  const [locations, date] = [await getBoardLocations(), todayLA()];
  const [boardTypes, coverage] = await Promise.all([
    getBoardTypes(),
    getBoardCoverage(date),
  ]);

  // Any appointment the Agenda booked that did not reach a board. This should
  // always be zero; showing it means a gap can never go unnoticed.
  const gaps = coverage.filter((c) => c.appointments > c.on_board);
  const missing = gaps.reduce((n, c) => n + (c.appointments - c.on_board), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Med Ops"
        title="Medical Boards"
        description="Streamlined daily workflow boards per department, per location — seeded from the ezyVet Agenda so the floor team can track every patient's status, services, and progress through the day."
      />

      {missing > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            {missing} appointment{missing === 1 ? "" : "s"} today {missing === 1 ? "is" : "are"} not on a board
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {gaps.map((g) => (
              <li key={`${g.location_id}:${g.dept_code}`}>
                {g.location_name} · {g.dept_name}: {g.on_board} of {g.appointments} on{" "}
                {g.board_label ?? "no board for this department"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {locations.length === 0 ? (
        <p className="text-sm text-slate-500">No active clinic locations found.</p>
      ) : (
        <div className="space-y-8">
          {locations.map((loc) => {
            const locRows = coverage.filter((c) => c.location_id === loc.id);
            const locTotal = locRows.reduce((n, c) => n + c.appointments, 0);
            return (
            <section key={loc.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: loc.color ?? "#94a3b8" }}
                  aria-hidden
                />
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  {loc.display_name ?? loc.name}
                </h2>
                {locTotal === 0 ? (
                  <span
                    title="The Agenda has no appointments for this clinic today — if that is unexpected, the morning report pull may have missed it."
                    className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                  >
                    No Agenda data today
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    {locTotal} appointment{locTotal === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {boardTypes.map((board) => {
                  const count = coverage.find(
                    (c) => c.location_id === loc.id && c.board_type === board.key,
                  );
                  return (
                    <Link
                      key={board.key}
                      href={`/med-ops/medical-boards/${locationSlug(loc)}/${board.key}?date=${date}`}
                      className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
                          style={{
                            backgroundColor: `${board.accent}1a`,
                            color: board.accent,
                          }}
                          aria-hidden
                        >
                          {board.icon}
                        </span>
                        {count && count.appointments > 0 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {count.appointments}
                          </span>
                        ) : (
                          <span
                            className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400"
                            aria-hidden
                          >
                            →
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {board.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {count && count.appointments > 0
                            ? `${count.appointments} booked today`
                            : "No appointments today"}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
