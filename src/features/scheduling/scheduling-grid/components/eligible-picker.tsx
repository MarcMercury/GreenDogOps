"use client";

import { useMemo, useState } from "react";
import {
  DAY_LABELS,
  gridName,
  timeRange,
  type SchedEmployeeSetting,
  type SchedPerson,
  type SchedRole,
  type SchedWeekLine,
  type ScheduleLocation,
  type WeekTimeOff,
} from "@/lib/schedule/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CellKey } from "@/features/scheduling/scheduling-grid/types/grid";

/** Eligible-employee picker: who can fill one shift line at one location on one day. */
export function EligiblePicker({
  cell,
  line,
  location,
  people,
  settings,
  membersByRole,
  roleName,
  roles,
  weeklyCount,
  scheduledByDay,
  weekTimeOff,
  assignedHere,
  onClose,
  onPick,
}: {
  cell: CellKey;
  line: SchedWeekLine;
  location: ScheduleLocation;
  people: SchedPerson[];
  settings: SchedEmployeeSetting[];
  membersByRole: Map<string, Set<string>>;
  roleName: (id: string | null) => string | null;
  roles: SchedRole[];
  weeklyCount: Map<string, number>;
  scheduledByDay: Map<number, Set<string>>;
  weekTimeOff: WeekTimeOff;
  assignedHere: Set<string>;
  onClose: () => void;
  onPick: (personId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const settingByPerson = useMemo(
    () => new Map(settings.map((s) => [s.person_id, s])),
    [settings],
  );

  const roleById = useMemo(
    () => new Map(roles.map((r) => [r.id, r] as const)),
    [roles],
  );

  // Roles each person belongs to (inverted membersByRole) for quick filters.
  const rolesByPerson = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [roleId, persons] of membersByRole) {
      for (const pid of persons) {
        if (!m.has(pid)) m.set(pid, new Set());
        m.get(pid)!.add(roleId);
      }
    }
    return m;
  }, [membersByRole]);

  // Distinct role *names* each person belongs to. Multiple role records can
  // share a display name (e.g. several "DVM" roles), so we collapse by name to
  // avoid duplicate filter options.
  const roleNamesByPerson = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [pid, ids] of rolesByPerson) {
      const names = new Set<string>();
      for (const id of ids) {
        const name = roleById.get(id)?.name;
        if (name) names.add(name);
      }
      m.set(pid, names);
    }
    return m;
  }, [rolesByPerson, roleById]);

  // People eligible for this shift before role/search filters apply.
  const baseEligible = useMemo(() => {
    const roleMembers = line.role_id ? membersByRole.get(line.role_id) : null;
    return people.filter((p) => {
      const s = settingByPerson.get(p.id);
      if (!s?.is_schedulable) return false;
      if (roleMembers && !roleMembers.has(p.id)) return false;
      // Location eligibility: empty list = any location.
      if (
        s &&
        s.eligible_location_ids.length > 0 &&
        !s.eligible_location_ids.includes(cell.locationId)
      )
        return false;
      // Day availability: empty list = any day.
      if (
        s &&
        s.available_days.length > 0 &&
        !s.available_days.includes(cell.day)
      )
        return false;
      return true;
    });
  }, [people, line.role_id, membersByRole, settingByPerson, cell.locationId, cell.day]);

  // Role filter options: distinct role names represented among eligible
  // people, sorted by the lowest sort_order of any role record with that name.
  const availableRoles = useMemo(() => {
    const byName = new Map<string, number>();
    for (const p of baseEligible) {
      const names = roleNamesByPerson.get(p.id);
      if (!names) continue;
      for (const name of names) {
        for (const r of roles) {
          if (r.name !== name) continue;
          const existing = byName.get(name);
          if (existing === undefined || r.sort_order < existing) {
            byName.set(name, r.sort_order);
          }
        }
      }
    }
    return [...byName.entries()]
      .map(([name, sort_order]) => ({ name, sort_order }))
      .sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      );
  }, [baseEligible, roleNamesByPerson, roles]);

  // People pickable for this shift. Anyone with time off this day (pending or
  // approved) is excluded — they are shown separately below, read-only, so the
  // admin sees why they are unavailable rather than just missing.
  const eligible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return baseEligible
      .filter((p) => {
        if (weekTimeOff.get(p.id)?.get(cell.day)) return false; // off this day
        if (roleFilter && !roleNamesByPerson.get(p.id)?.has(roleFilter))
          return false;
        if (term && !gridName(p).toLowerCase().includes(term)) return false;
        return true;
      })
      .sort((a, b) => {
        const ca = weeklyCount.get(a.id) ?? 0;
        const cb = weeklyCount.get(b.id) ?? 0;
        if (ca !== cb) return ca - cb; // least-loaded first
        return gridName(a).localeCompare(gridName(b));
      });
  }, [
    baseEligible,
    roleFilter,
    roleNamesByPerson,
    q,
    weeklyCount,
    weekTimeOff,
    cell.day,
  ]);

  // Role-eligible people who are off this day, shown read-only below the list.
  const offToday = useMemo(
    () =>
      baseEligible
        .filter((p) => !!weekTimeOff.get(p.id)?.get(cell.day))
        .map((p) => ({
          person: p,
          status: weekTimeOff.get(p.id)!.get(cell.day)!,
        }))
        .sort((a, b) => gridName(a.person).localeCompare(gridName(b.person))),
    [baseEligible, weekTimeOff, cell.day],
  );

  const dayScheduled = scheduledByDay.get(cell.day) ?? new Set<string>();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{line.label || roleName(line.role_id) || "Shift"}</DialogTitle>
          <DialogDescription>
            {DAY_LABELS[cell.day]} · {location.name} · {timeRange(line.start_time, line.end_time)}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search eligible employees…"
        />
        {availableRoles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant={roleFilter === null ? "default" : "secondary"}
              className="rounded-full"
              onClick={() => setRoleFilter(null)}
            >
              All
            </Button>
            {availableRoles.map((r) => (
              <Button
                key={r.name}
                size="xs"
                variant={roleFilter === r.name ? "default" : "secondary"}
                className="rounded-full"
                onClick={() => setRoleFilter((cur) => (cur === r.name ? null : r.name))}
              >
                {r.name}
              </Button>
            ))}
          </div>
        )}
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {eligible.map((p) => {
            const s = settingByPerson.get(p.id);
            const count = weeklyCount.get(p.id) ?? 0;
            const target = s?.weekly_shift_target ?? 5;
            const here = assignedHere.has(p.id);
            const elsewhere = !here && dayScheduled.has(p.id);
            const atTarget = count >= target;
            return (
              <li key={p.id}>
                <Button
                  variant="ghost"
                  disabled={here}
                  onClick={() => onPick(p.id)}
                  className={`h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal ${
                    here ? "bg-emerald-50 text-emerald-700 disabled:opacity-100" : ""
                  }`}
                >
                  <span className="flex-1 truncate">
                    {gridName(p)}
                    {elsewhere && (
                      <span
                        className="ml-1.5 text-[10px] font-medium text-amber-600"
                        title="Already scheduled this day"
                      >
                        ● today
                      </span>
                    )}
                  </span>
                  {here ? (
                    <span className="text-xs font-semibold">✓ added</span>
                  ) : (
                    <Badge
                      variant="secondary"
                      className={atTarget ? "bg-red-100 text-red-600" : ""}
                      title="Shifts this week / target"
                    >
                      {count}/{target}
                    </Badge>
                  )}
                </Button>
              </li>
            );
          })}
          {eligible.length === 0 && offToday.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              No eligible employees. Assign people to this role in Set Up → Roles & Eligibility.
            </li>
          )}
          {offToday.length > 0 && (
            <li className="mt-1 border-t pt-1">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Off this day — not schedulable
              </p>
              <ul>
                {offToday.map(({ person, status }) => (
                  <li key={person.id}>
                    <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm opacity-70">
                      <span className="flex-1 truncate text-muted-foreground line-through">
                        {gridName(person)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={
                          status === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }
                        title={status === "approved" ? "Approved time off" : "Pending time-off request"}
                      >
                        {status === "approved" ? "Approved off" : "Pending off"}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
