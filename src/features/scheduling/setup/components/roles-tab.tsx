"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gridName, type SchedRole } from "@/lib/schedule/types";
import type { ActionResult } from "@/features/scheduling/shared/types/action-result";
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
import { inputCls } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";
import { AddRoleForm } from "@/features/scheduling/setup/components/add-role-form";
import { EligibilityMatrixHeader } from "@/features/scheduling/setup/components/eligibility-matrix-header";
import { EligibilityRow } from "@/features/scheduling/setup/components/eligibility-row";

// ===========================================================================
// Roles & Eligibility
// ===========================================================================

export function RolesTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
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
    setError(null);
    setElig((prev) => {
      const next = new Set(prev);
      if (wasEligible) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaving((n) => n + 1);
    let res: ActionResult;
    if (isStudentFlagRole(roleId)) {
      // Persist both student flags together; the flag not being toggled keeps
      // its current value from the eligibility set.
      const { mentor, coordinator } = nextStudentFlags(roleId, personId, wasEligible, elig);
      res = await setStudentRoleFlags(personId, mentor, coordinator);
    } else {
      res = await toggleRoleMember(roleId, personId, !wasEligible);
    }
    setSaving((n) => n - 1);
    if (!res.ok) {
      // Revert on failure.
      setElig((prev) => {
        const next = new Set(prev);
        if (wasEligible) next.add(key);
        else next.delete(key);
        return next;
      });
      setError(res.error);
    }
  }

  function removeRole(r: SchedRole) {
    if (
      !window.confirm(
        `Delete role “${r.name}”? This clears every employee's eligibility for it.`,
      )
    )
      return;
    start(async () => {
      const res = await deleteRole(r.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              Eligibility matrix
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Check a box to make an employee eligible for a role. Changes save
              instantly and mirror the HR profile &amp; schedule grid. Only
              people marked Scheduling Active in HR / Roster are listed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saving > 0 && (
              <span className="text-[11px] text-slate-400">Saving…</span>
            )}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employees…"
              className={inputCls}
            />
          </div>
        </div>
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
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </Card>

      {orderedRoles.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">
            Add a role above to start assigning eligibility.
          </p>
        </Card>
      ) : (
        <div className="relative max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <EligibilityMatrixHeader
                deptGroups={deptGroups}
                columns={columns}
                collapsed={collapsed}
                pending={pending}
                onToggleDept={toggleDept}
                onRemoveRole={removeRole}
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
                    className="px-3 py-6 text-center text-xs text-slate-400"
                  >
                    No Scheduling Active employees match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
