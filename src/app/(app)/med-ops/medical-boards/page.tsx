import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { PageHeader } from "../../_components/ui";
import { BOARD_TYPES, locationSlug } from "@/lib/med-ops/types";
import { getBoardLocations } from "./data";

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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Med Ops"
        title="Medical Boards"
        description="Streamlined daily workflow boards per department, per location — seeded from the ezyVet Agenda so the floor team can track every patient's status, services, and progress through the day."
      />

      {locations.length === 0 ? (
        <p className="text-sm text-slate-500">No active clinic locations found.</p>
      ) : (
        <div className="space-y-8">
          {locations.map((loc) => (
            <section key={loc.id} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: loc.color ?? "#94a3b8" }}
                  aria-hidden
                />
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  {loc.display_name ?? loc.name}
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {BOARD_TYPES.map((board) => (
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
                      <span
                        className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400"
                        aria-hidden
                      >
                        →
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {board.label}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Today&apos;s workflow
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
