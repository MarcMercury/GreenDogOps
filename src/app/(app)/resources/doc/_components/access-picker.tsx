"use client";

import { useMemo, useState } from "react";
import { APP_ROLES } from "@/lib/auth/permissions";
import { ROLE_SHORT_LABELS } from "@/lib/resources/access";

export interface AccessValue {
  everyone: boolean;
  roles: Set<string>;
  viewers: Set<string>;
}

export interface PickerPerson {
  id: string;
  name: string;
  role: string;
}

/**
 * Everyone, or chosen roles plus chosen people — the document's recipients
 * (notified, asked to sign). HR / Managers and above can always open it.
 */
export function AccessPicker({
  value,
  people,
  onChange,
}: {
  value: AccessValue;
  people: PickerPerson[];
  onChange: (v: AccessValue) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [people, filter]);

  const toggle = (key: "roles" | "viewers", item: string) => {
    const next = new Set(value[key]);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="radio" checked={value.everyone} onChange={() => onChange({ ...value, everyone: true })} className="text-emerald-600" />
        Everyone in Ops
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={!value.everyone} onChange={() => onChange({ ...value, everyone: false })} className="text-emerald-600" />
        Only these roles and people
      </label>
      {!value.everyone ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {APP_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={value.roles.has(r)}
                  onChange={() => toggle("roles", r)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                {ROLE_SHORT_LABELS[r]}
              </label>
            ))}
          </div>
          <div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a person…"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {shown.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.viewers.has(p.id)}
                    onChange={() => toggle("viewers", p.id)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <span>{p.name}</span>
                  <span className="text-xs text-slate-400">
                    {ROLE_SHORT_LABELS[p.role as keyof typeof ROLE_SHORT_LABELS] ?? p.role}
                  </span>
                </label>
              ))}
              {!shown.length ? <p className="text-xs text-slate-400">No matches.</p> : null}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Only the roles and people chosen here are notified and asked to sign. HR / Managers, Executives, Admins and
            Owners can always open the document to manage it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
