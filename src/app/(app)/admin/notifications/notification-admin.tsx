"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, ROLE_LABELS, type AppRole, type ModuleKey } from "@/lib/auth/permissions";
import type { AdminDeliveryView, AdminRuleView, RoutePreview } from "@/lib/notify/admin";
import { NOTIFY_PRIORITIES, type RuleConfig } from "@/lib/notify/types";
import {
  loadSlackChannelOptions,
  previewNotificationRule,
  resetNotificationRule,
  retryDelivery,
  runDispatchNow,
  saveNotificationRule,
  sendTestNotification,
} from "./actions";

type Msg = { ok: boolean; text: string } | null;

const EDITOR_MODULES: { key: ModuleKey; label: string }[] = [
  { key: "schedule", label: "Scheduling" },
  { key: "marketing", label: "Marketing" },
  { key: "hr", label: "HR" },
  { key: "ats", label: "Recruiting" },
  { key: "resources", label: "Resources" },
];

const BTN =
  "rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-emerald-600 text-white hover:bg-emerald-700`;
const BTN_SECONDARY = `${BTN} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</span>;
}

export function ProcessQueueButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="flex items-center gap-3">
      <Feedback msg={msg} />
      <button
        type="button"
        disabled={pending}
        className={BTN_PRIMARY}
        onClick={() =>
          start(async () => {
            const res = await runDispatchNow();
            setMsg(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
            router.refresh();
          })
        }
      >
        {pending ? "Processing…" : "Process queue now"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function summarize(rule: RuleConfig, people: Map<string, string>, depts: Map<string, string>, direct: boolean): string {
  if (direct) return "The person it's for";
  const a = rule.audience;
  const parts: string[] = [];
  if (a.subjects) parts.push("People it's about");
  if (a.candidates) parts.push("Eligible staff");
  if (a.roles.length) parts.push(a.roles.map((r) => ROLE_LABELS[r]).join(", "));
  if (a.editorsOf.length) parts.push(`Editors of ${a.editorsOf.join(", ")}`);
  if (a.departmentIds.length) parts.push(a.departmentIds.map((d) => depts.get(d) ?? "dept").join(", "));
  if (a.personIds.length) parts.push(a.personIds.map((p) => people.get(p) ?? "someone").join(", "));
  let out = parts.join(" · ") || "Nobody";
  if (a.sameLocation) out += " (same location)";
  return out;
}

function deliverySummary(rule: RuleConfig): string {
  const parts: string[] = [];
  if (rule.deliverDm) parts.push("Slack DM");
  if (rule.deliverInbox) parts.push("Inbox");
  if (rule.channelId) parts.push(`#${rule.channelName ?? "channel"}`);
  let out = parts.join(" + ") || "—";
  if (rule.batchMinutes) out += ` · batched ${rule.batchMinutes}m`;
  if (rule.escalateAfterHours) out += ` · escalates after ${rule.escalateAfterHours}h`;
  return out;
}

export function NotificationRules({
  rules,
  groups,
  people,
  departments,
  canEdit,
}: {
  rules: AdminRuleView[];
  groups: string[];
  people: { id: string; name: string; hasSlack: boolean; hasLogin: boolean }[];
  departments: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rules
              .filter((r) => r.group === group)
              .map((r) => (
                <div key={r.type}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === r.type ? null : r.type)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span className={`h-2 w-2 rounded-full ${r.rule.enabled ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
                    <span className="min-w-[12rem] flex-1 text-sm font-medium text-slate-800">
                      {r.label}
                      {r.overridden ? (
                        <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">customized</span>
                      ) : null}
                      {r.actions.length ? (
                        <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">buttons</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-slate-500">{summarize(r.rule, peopleMap, deptMap, r.direct)}</span>
                    <span className="text-xs text-slate-400">{r.rule.enabled ? deliverySummary(r.rule) : "Off"}</span>
                  </button>
                  {open === r.type ? (
                    <RuleEditor
                      key={`${r.type}:${r.updatedAt ?? "default"}`}
                      view={r}
                      people={people}
                      departments={departments}
                      canEdit={canEdit}
                    />
                  ) : null}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-slate-400">{hint}</span> : null}
      </span>
    </label>
  );
}

function RuleEditor({
  view,
  people,
  departments,
  canEdit,
}: {
  view: AdminRuleView;
  people: { id: string; name: string; hasSlack: boolean; hasLogin: boolean }[];
  departments: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rule, setRule] = useState<RuleConfig>(view.rule);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string; isPrivate: boolean; isMember: boolean }[] | null>(
    null,
  );
  const [personPick, setPersonPick] = useState("");
  const a = rule.audience;
  const setAudience = (patch: Partial<RuleConfig["audience"]>) => setRule({ ...rule, audience: { ...a, ...patch } });
  const disabled = !canEdit || pending;

  const run = (fn: () => Promise<void>) => start(fn);

  return (
    <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 py-4">
      <p className="text-xs text-slate-500">
        {view.description}{" "}
        {view.sensitivity === "module" ? (
          <span className="text-amber-700">
            Restricted: besides the people it&apos;s about, only staff whose Ops access includes {view.module} receive it.
          </span>
        ) : null}
      </p>

      <Check label="Enabled" checked={rule.enabled} onChange={(v) => setRule({ ...rule, enabled: v })} disabled={disabled} />

      {!view.direct ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Who</p>
            <Check
              label="People it's about"
              hint="e.g. the employee whose shift changed"
              checked={a.subjects}
              onChange={(v) => setAudience({ subjects: v })}
              disabled={disabled}
            />
            {view.type === "schedule.coverage_needed" ? (
              <Check
                label="Eligible staff"
                hint="Same scheduling role, not working or off that day"
                checked={a.candidates}
                onChange={(v) => setAudience({ candidates: v })}
                disabled={disabled}
              />
            ) : null}
            <p className="pt-1 text-xs text-slate-500">Ops roles</p>
            {APP_ROLES.map((role) => (
              <Check
                key={role}
                label={ROLE_LABELS[role as AppRole]}
                checked={a.roles.includes(role)}
                onChange={(v) => setAudience({ roles: toggle(a.roles, role, v) })}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Also</p>
            <p className="text-xs text-slate-500">Anyone who can edit</p>
            {EDITOR_MODULES.map((m) => (
              <Check
                key={m.key}
                label={m.label}
                checked={a.editorsOf.includes(m.key)}
                onChange={(v) => setAudience({ editorsOf: toggle(a.editorsOf, m.key, v) })}
                disabled={disabled}
              />
            ))}
            {departments.length ? <p className="pt-1 text-xs text-slate-500">Scheduling departments</p> : null}
            {departments.map((d) => (
              <Check
                key={d.id}
                label={d.name}
                checked={a.departmentIds.includes(d.id)}
                onChange={(v) => setAudience({ departmentIds: toggle(a.departmentIds, d.id, v) })}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Specific people</p>
            <div className="flex gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                value={personPick}
                disabled={disabled}
                onChange={(e) => setPersonPick(e.target.value)}
              >
                <option value="">Add a person…</option>
                {people
                  .filter((p) => !a.personIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.hasSlack ? "" : " (no Slack)"}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={disabled || !personPick}
                onClick={() => {
                  setAudience({ personIds: toggle(a.personIds, personPick, true) });
                  setPersonPick("");
                }}
              >
                Add
              </button>
            </div>
            <ul className="space-y-1">
              {a.personIds.map((id) => (
                <li key={id} className="flex items-center justify-between text-sm">
                  <span>{people.find((p) => p.id === id)?.name ?? "No longer active"}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => setAudience({ personIds: a.personIds.filter((p) => p !== id) })}
                    >
                      remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="space-y-2 pt-2">
              <Check
                label="Only at the event's location"
                hint="Roles, editors and departments are limited to people based at that clinic"
                checked={a.sameLocation}
                onChange={(v) => setAudience({ sameLocation: v })}
                disabled={disabled}
              />
              <Check
                label="Skip the person who made the change"
                checked={a.excludeActor}
                onChange={(v) => setAudience({ excludeActor: v })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Sent to the one person it&apos;s for; you can turn it off or change how it&apos;s delivered.</p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-slate-500">How</p>
          <Check label="Slack direct message" checked={rule.deliverDm} onChange={(v) => setRule({ ...rule, deliverDm: v })} disabled={disabled} />
          <Check
            label="In-app inbox"
            hint="Only for people with an Ops login; the fallback when Slack fails"
            checked={rule.deliverInbox}
            onChange={(v) => setRule({ ...rule, deliverInbox: v })}
            disabled={disabled}
          />
          {view.allowChannel ? (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-slate-500">Also post to a channel</p>
              {channels ? (
                <select
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                  value={rule.channelId ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const c = channels.find((x) => x.id === e.target.value);
                    setRule({ ...rule, channelId: c?.id ?? null, channelName: c?.name ?? null });
                  }}
                >
                  <option value="">No channel</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.isPrivate ? "🔒 " : "#"}
                      {c.name}
                      {c.isPrivate && !c.isMember ? " (invite the app first)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">{rule.channelId ? `#${rule.channelName ?? rule.channelId}` : "None"}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const res = await loadSlackChannelOptions();
                          if (res.ok) setChannels(res.channels);
                          else setMsg({ ok: false, text: res.error });
                        })
                      }
                    >
                      Choose…
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Timing</p>
          <label className="block text-sm text-slate-700">
            Priority
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
              value={rule.priority}
              disabled={disabled}
              onChange={(e) => setRule({ ...rule, priority: e.target.value as RuleConfig["priority"] })}
            >
              {NOTIFY_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {!view.direct ? (
            <label className="block text-sm text-slate-700">
              Batch DMs for (minutes)
              <input
                type="number"
                min={0}
                max={1440}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                value={rule.batchMinutes}
                disabled={disabled}
                onChange={(e) => setRule({ ...rule, batchMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })}
              />
              <span className="text-xs text-slate-400">0 = send right away. Updates in the window go out as one message.</span>
            </label>
          ) : null}
        </div>
        {view.escalatable ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Escalation</p>
            <label className="block text-sm text-slate-700">
              If still waiting after (hours)
              <input
                type="number"
                min={1}
                max={720}
                placeholder="never"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                value={rule.escalateAfterHours ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  setRule({ ...rule, escalateAfterHours: e.target.value ? Math.max(1, Math.min(720, Number(e.target.value))) : null })
                }
              />
            </label>
            {rule.escalateAfterHours ? (
              <>
                <p className="text-xs text-slate-500">…notify these roles</p>
                {APP_ROLES.filter((r) => r !== "staff").map((role) => (
                  <Check
                    key={role}
                    label={ROLE_LABELS[role]}
                    checked={rule.escalateRoles.includes(role)}
                    onChange={(v) => setRule({ ...rule, escalateRoles: toggle(rule.escalateRoles, role, v) })}
                    disabled={disabled}
                  />
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await saveNotificationRule(view.type, rule);
                setMsg(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            Save
          </button>
        ) : null}
        {!view.direct ? (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await previewNotificationRule(view.type, rule);
                if (res.ok) {
                  setPreview(res.preview);
                  setMsg(null);
                } else setMsg({ ok: false, text: res.error });
              })
            }
          >
            Preview recipients
          </button>
        ) : null}
        {canEdit && !view.direct ? (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await sendTestNotification(view.type);
                setMsg(res.ok ? { ok: true, text: res.message ?? "Sent." } : { ok: false, text: res.error });
              })
            }
          >
            Send me a test
          </button>
        ) : null}
        {canEdit && view.overridden ? (
          <button
            type="button"
            className={`${BTN_SECONDARY} text-rose-700`}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await resetNotificationRule(view.type);
                setMsg(res.ok ? { ok: true, text: res.message ?? "Reset." } : { ok: false, text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            Reset to default
          </button>
        ) : null}
        <Feedback msg={msg} />
      </div>

      {preview ? <PreviewList preview={preview} /> : null}
    </div>
  );
}

function PreviewList({ preview }: { preview: RoutePreview }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      {preview.notes.map((n) => (
        <p key={n} className="text-xs text-slate-500">
          {n}
        </p>
      ))}
      <p className="font-medium text-slate-700">
        {preview.recipients.length} fixed recipient{preview.recipients.length === 1 ? "" : "s"}
      </p>
      {preview.recipients.length ? (
        <ul className="grid gap-1 sm:grid-cols-2">
          {preview.recipients.map((r) => (
            <li key={r.name + r.reasons.join()} className="text-slate-700">
              {r.name} <span className="text-xs text-slate-400">({r.reasons.join(", ")})</span>{" "}
              {r.slack ? "💬" : <span className="text-xs text-amber-700">no Slack</span>} {r.inbox ? "📥" : ""}{" "}
              {r.canAct ? <span className="text-xs text-violet-700">can approve</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.excluded.length ? (
        <>
          <p className="pt-1 font-medium text-slate-700">Left out</p>
          <ul className="space-y-0.5">
            {preview.excluded.map((e) => (
              <li key={e.name + e.reason} className="text-xs text-slate-500">
                {e.name}: {e.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-800",
  pending: "bg-sky-100 text-sky-800",
  sending: "bg-sky-100 text-sky-800",
  skipped: "bg-slate-100 text-slate-600",
  failed: "bg-rose-100 text-rose-700",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DeliveryLog({ deliveries, canEdit }: { deliveries: AdminDeliveryView[]; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const shown = filter === "all" ? deliveries : deliveries.filter((d) => d.status === filter);

  if (deliveries.length === 0) return <p className="text-sm text-slate-500">Nothing has been delivered yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {["all", "sent", "pending", "skipped", "failed"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {s}
          </button>
        ))}
        <Feedback msg={msg} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">To</th>
              <th className="py-2 pr-4">Notification</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((d) => (
              <tr key={d.id} className="align-top">
                <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{when(d.createdAt)}</td>
                <td className="py-2 pr-4">
                  {d.recipient}
                  {d.reason ? <span className="block text-xs text-slate-400">{d.reason}</span> : null}
                </td>
                <td className="py-2 pr-4">
                  <span className="block max-w-xs truncate" title={d.title}>
                    {d.title}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {d.eventType ?? ""}
                    {d.batched ? " · batched" : ""}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[d.status] ?? STATUS_TONE.skipped}`}>
                    {d.status}
                  </span>
                  {d.attempts > 1 ? <span className="ml-1 text-xs text-slate-400">×{d.attempts}</span> : null}
                </td>
                <td className="py-2 text-xs text-slate-500">
                  {d.lastError ?? d.resolvedNote ?? (d.acknowledgedAt ? "Acknowledged" : "")}
                  {canEdit && d.status === "failed" ? (
                    <button
                      type="button"
                      disabled={pending}
                      className="ml-2 text-emerald-700 hover:underline disabled:opacity-50"
                      title="It may already have reached Slack if it failed on a timeout."
                      onClick={() =>
                        start(async () => {
                          const res = await retryDelivery(d.id);
                          setMsg(res.ok ? { ok: true, text: res.message ?? "Retried." } : { ok: false, text: res.error });
                          router.refresh();
                        })
                      }
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
