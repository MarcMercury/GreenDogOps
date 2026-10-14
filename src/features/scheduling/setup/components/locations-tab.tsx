import { formatAddress } from "@/lib/shared/locations";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { Card } from "@/features/scheduling/setup/components/card";

// ===========================================================================
// Locations (read-only — managed in Admin → Locations, the source of truth)
// ===========================================================================

export function LocationsTab({ data }: { data: SetupData }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Locations</h2>
        <a
          href="/admin/locations"
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          Manage in Admin → Locations
        </a>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Locations are managed centrally in Admin so Settings and the schedule
        always match. Active locations below appear as columns on the grid.
      </p>
      <ul className="divide-y divide-slate-100">
        {data.locations
          .filter((l) => l.is_active)
          .map((l) => {
            const address = formatAddress(l);
            return (
              <li key={l.id} className="flex items-start gap-3 py-2">
                <span
                  className="mt-1 h-4 w-4 shrink-0 rounded"
                  style={{ background: l.color ?? "#64748b" }}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {l.name}
                    {l.short_code ? (
                      <span className="ml-2 text-xs text-slate-400">
                        {l.short_code}
                      </span>
                    ) : null}
                  </p>
                  {address ? (
                    <p className="text-xs text-slate-400">{address}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
