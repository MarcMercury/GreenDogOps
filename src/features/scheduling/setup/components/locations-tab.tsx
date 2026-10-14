"use client";

import { formatAddress } from "@/lib/shared/locations";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";

// ===========================================================================
// Locations (read-only — managed in Admin → Locations, the source of truth)
// ===========================================================================

export function LocationsTab({ data }: { data: SetupData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
        <CardDescription>
          Locations are managed centrally in Admin so Settings and the schedule
          always match. Active locations below appear as columns on the grid.
        </CardDescription>
        <CardAction>
          <a href="/admin/locations" className={buttonVariants({ variant: "link", size: "sm" })}>
            Manage in Admin → Locations
          </a>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
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
                    <p className="text-sm font-medium">
                      {l.name}
                      {l.short_code ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {l.short_code}
                        </span>
                      ) : null}
                    </p>
                    {address ? (
                      <p className="text-xs text-muted-foreground">{address}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
        </ul>
      </CardContent>
    </Card>
  );
}
