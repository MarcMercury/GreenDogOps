"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Search box and the "only with recorded attendance" cut, above the table. */
export function AttendanceFilters({
  query,
  onQueryChange,
  onlyResolved,
  onOnlyResolvedChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onlyResolved: boolean;
  onOnlyResolvedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search employees…"
        aria-label="Search employees"
        className="w-56"
      />
      <Label htmlFor="attendance-only-resolved" className="font-normal text-muted-foreground">
        <Checkbox
          id="attendance-only-resolved"
          checked={onlyResolved}
          onCheckedChange={(checked) => onOnlyResolvedChange(checked === true)}
        />
        Only with recorded attendance
      </Label>
    </div>
  );
}
