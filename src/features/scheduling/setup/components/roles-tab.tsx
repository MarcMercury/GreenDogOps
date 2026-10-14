"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { gridName, type SchedRole } from "@/lib/schedule/types";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/features/scheduling/shared/components/confirm-dialog";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  deleteRole,
  setStudentRoleFlags,
  toggleRoleMember,
} from "@/features/scheduling/setup/actions/role-actions";
import {
  buildDeptGroups,
  buildMatrixColumns,
  eligibilityKey,
  initialEligibility,
  isStudentFlagRole,
  nextStudentFlags,
  schedulablePersonIds,
} from "@/features/scheduling/setup/lib/eligibility";
import { AddRoleForm } from "@/features/scheduling/setup/components/add-role-form";
import { EligibilityMatrixHeader } from "@/features/scheduling/setup/components/eligibility-matrix-header";
import { EligibilityRow } from "@/features/scheduling/setup/components/eligibility-row";

// ===========================================================================
// Roles & Eligibility
// ===========================================================================

export function RolesTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(0);
  const [roleToDelete, setRoleToDelete] = useState<SchedRole | null>(null);
  // Departments collapsed horizontally, keyed by department id. Default to all
  // departments collapsed so the matrix opens compact.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(data.departments.map((d) => d.id)),
  );

  // Optimistic eligibility set, keyed by "roleId:personId". Real shift roles
  // come from `sched_role_member`; the synthetic Student pseudo-roles come from
  // the per-employee `is_student_mentor` / `is_student_coordinator` flags.
  const [elig, setElig] = useState<Set<string>>(() =>
    initialEligibility(data.members, data.settings),
  );

  // Roles grouped by department, in configured order — drives the columns.
  const deptGroups = useMemo(
    () => buildDeptGroups(data.departments, data.roles),
    [data.departments, data.roles],
  );
  const orderedRoles = useMemo(
    () => deptGroups.flatMap((g) => g.roles),
    [deptGroups],
  );

  // Flattened visible columns (expanded roles, "no roles" placeholders and
  // collapsed strips).
  const columns = useMemo(
    () => buildMatrixColumns(deptGroups, collapsed),
    [deptGroups, collapsed],
  );

  // Employees — the rows. Only people flagged Scheduling Active in HR / Roster
  // are ever scheduled, so they are the only ones worth an eligibility row.
  const schedulablePeople = useMemo(
    () => schedulablePersonIds(data.settings),
    [data.settings],
  );
  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.people
      .filter((p) => schedulablePeople.has(p.id))
      .filter((p) => !term || gridName(p).toLowerCase().includes(term))
      .sort((a, b) => gridName(a).localeCompare(gridName(b)));
  }, [data.people, q, schedulablePeople]);

  async function toggle(roleId: string, personId: string) {
    const key = eligibilityKey(roleId, personId);
    const wasEligible = elig.has(key);
    setElig((prev) => {
      const next = new Set(prev);
      if (wasEligible) next.delete(key);
      else next.add(key);
      return next;
    });
    // Revert on failure.
    const revert = () =>
      setElig((prev) => {
        const next = new Set(prev);
        if (wasEligible) next.add(key);
        else next.delete(key);
        return next;
      });
    setSaving((n) => n + 1);
    // The matrix is optimistic, so the page is not refreshed on success — a
    // refresh would fight the next click; the toast confirms the save.
    const options = { refresh: false, onError: revert };
    const res = isStudentFlagRole(roleId)
      ? // Persist both student flags together; the flag not being toggled keeps
        // its current value from the eligibility set.
        await run(
          () => {
            const { mentor, coordinator } = nextStudentFlags(roleId, personId, wasEligible, elig);
            return setStudentRoleFlags(personId, mentor, coordinator);
          },
          "Eligibility saved",
          options,
        )
      : await run(() => toggleRoleMember(roleId, personId, !wasEligible), "Eligibility saved", options);
    if (!res) revert(); // the call itself threw (network); the toast already said so
    setSaving((n) => n - 1);
  }

  function toggleDept(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const colCount = columns.length + 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Eligibility matrix</CardTitle>
          <CardDescription>
            Check a box to make an employee eligible for a role. Changes save
            instantly and mirror the HR profile &amp; schedule grid. Only
            people marked Scheduling Active in HR / Roster are listed.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {saving > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Spinner className="size-3" /> Saving…
              </span>
            )}
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employees…"
              aria-label="Search employees"
              className="w-56"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <AddRoleForm
            data={data}
            onSaved={(deptId) => {
              // Reveal the new column instead of burying it in a collapsed strip.
              setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(deptId);
                return next;
              });
              router.refresh();
            }}
          />
        </CardContent>
      </Card>

      {orderedRoles.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Add a role above to start assigning eligibility.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative max-h-[72vh] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <EligibilityMatrixHeader
                deptGroups={deptGroups}
                columns={columns}
                collapsed={collapsed}
                pending={pending}
                onToggleDept={toggleDept}
                onRemoveRole={setRoleToDelete}
              />
            </thead>
            <tbody>
              {people.map((p) => (
                <EligibilityRow
                  key={p.id}
                  person={p}
                  columns={columns}
                  elig={elig}
                  onToggle={toggle}
                />
              ))}
              {people.length === 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    No Scheduling Active employees match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={roleToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRoleToDelete(null);
        }}
        title={`Delete role “${roleToDelete?.name ?? ""}”?`}
        description="This clears every employee's eligibility for it."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const role = roleToDelete;
          if (!role) return;
          return run(() => deleteRole(role.id), "Role deleted");
        }}
      />
    </div>
  );
}
