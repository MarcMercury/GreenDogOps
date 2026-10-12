// End-to-end check of the notification engine (0236) against STAGING only
// (refuses any other project). Slack's Web API is mocked inside this process —
// nothing is ever sent to Slack. Creates synthetic people/logins/time-off,
// runs the real engine, dispatcher, producers and button handler, asserts on
// the rows they write, then deletes everything it made.
//
//   mkdir -p /tmp/stub/node_modules/server-only \
//     && echo '{"name":"server-only","main":"index.js"}' > /tmp/stub/node_modules/server-only/package.json \
//     && echo 'module.exports={}' > /tmp/stub/node_modules/server-only/index.js
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/e2e_notification_engine.mts
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".secrets/supabase-staging.env", "utf8").split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m![1], m![2].replace(/^["']|["']$/g, "")]),
);
if (!String(env.STAGING_SUPABASE_URL).includes("yzxcuiwklrmxarzjzukr")) throw new Error("not staging");
process.env.NEXT_PUBLIC_SUPABASE_URL = env.STAGING_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.STAGING_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = "greendogops";
process.env.SLACK_BOT_TOKEN = "xoxb-e2e-mock";
process.env.SLACK_DM_LIVE = "true";
process.env.APP_BASE_URL = "https://ops.e2e.invalid";
delete process.env.SLACK_WORKFLOW_WEBHOOK_URL;

// ---- Slack mock: every slack.com call is answered here and recorded ----
type SlackCall = { method: string; body: Record<string, unknown> };
const slackCalls: SlackCall[] = [];
let tsCounter = 1000;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://slack.com/api/")) {
    const method = url.slice("https://slack.com/api/".length).split("?")[0];
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    slackCalls.push({ method, body });
    const channel = String(body.channel ?? "D000");
    return new Response(JSON.stringify({ ok: true, ts: `${++tsCounter}.000100`, channel: channel.startsWith("U") ? `D${channel.slice(1)}` : channel }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("https://hooks.slack.com/")) throw new Error("e2e: no outbound webhooks");
  return realFetch(input, init);
}) as typeof fetch;

const { createAdminClient } = await import("@/lib/supabase/admin");
const { emitEvent } = await import("@/lib/notify/emit");
const { dispatchPendingDeliveries } = await import("@/lib/notify/dispatch");
const { runProducers } = await import("@/lib/notify/producers");
const { handleSlackAction } = await import("@/lib/notify/interactions");
const { notifyTimeOffRequested } = await import("@/lib/notify/events/schedule");
const { notifyMarketingEventSaved } = await import("@/lib/notify/events/marketing");
const tasks = await import("@/lib/worklist/tasks");
const admin = createAdminClient();

let failures = 0;
const check = (name: string, cond: unknown, extra?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra !== undefined ? " " + JSON.stringify(extra) : ""}`);
  if (!cond) failures++;
};

const tag = `e2e${Date.now()}`;
const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const created = { people: [] as string[], users: [] as string[], timeOff: [] as string[], events: [] as string[], rules: [] as string[] };

async function makePerson(first: string, role: string | null, opts: { slack?: boolean; moduleAccess?: Record<string, boolean> } = {}) {
  const { data: p, error } = await admin
    .from("person")
    .insert({ first_name: first, last_name: tag, full_name: `${first} ${tag}`, status: "employee" })
    .select("id")
    .single();
  if (error) throw new Error(`person: ${error.message}`);
  const personId = (p as { id: string }).id;
  created.people.push(personId);
  let slackUserId: string | null = null;
  if (opts.slack !== false) {
    slackUserId = `UE2E${rnd()}`;
    const l = await admin.from("person_slack_link").upsert({ person_id: personId, status: "connected", slack_user_id: slackUserId, match_method: "manual" });
    if (l.error) throw new Error(`slack link: ${l.error.message}`);
  }
  let userId: string | null = null;
  if (role) {
    userId = crypto.randomUUID();
    const u = await admin.from("app_user").insert({
      id: userId, email: `${first.toLowerCase()}-${tag}@example.invalid`, full_name: `${first} ${tag}`,
      role, is_active: true, module_access: opts.moduleAccess ?? {}, person_id: personId,
    });
    if (u.error) throw new Error(`app_user: ${u.error.message}`);
    created.users.push(userId);
  }
  return { personId, userId, slackUserId: slackUserId! };
}

async function deliveriesFor(eventId: string) {
  const { data } = await admin
    .from("notification_delivery")
    .select("id, recipient_person_id, recipient_user_id, channel, status, last_error, blocks, required_module, slack_ts, slack_channel_id, title, batched, coalesce_key, message_key, resolved_note")
    .eq("event_id", eventId);
  return (data ?? []) as Array<Record<string, unknown> & { id: string; recipient_person_id: string; status: string }>;
}

async function eventIdByKey(key: string): Promise<string> {
  const { data } = await admin.from("notification_event").select("id").eq("dedupe_key", key).maybeSingle();
  const id = (data as { id: string } | null)?.id ?? "";
  if (id) created.events.push(id);
  return id;
}

const touchedRules = ["pto.requested", "schedule.shift_changed", "marketing.event_updated", "task.completed"];
const extraSubjects: string[] = [];
const { data: priorRules } = await admin.from("notification_rule").select("event_type").in("event_type", touchedRules);
if ((priorRules ?? []).length) throw new Error("staging already has rules for the types this test edits — aborting");

try {
  const subject = await makePerson("Subject", null); // employee, no Ops login
  const sched = await makePerson("Sched", "schedule_admin");
  const noAccess = await makePerson("NoAccess", "manager", { moduleAccess: { schedule: false } });
  const mkt = await makePerson("Mkt", "marketing_admin");
  const owner = await makePerson("Owner", "owner");
  const noSlack = await makePerson("NoSlack", "schedule_admin", { slack: false });

  // Route pto.requested to schedule admins + two named people who must be filtered out.
  await admin.from("notification_rule").insert({
    event_type: "pto.requested",
    audience: { roles: ["schedule_admin"], personIds: [noAccess.personId, subject.personId], excludeActor: true },
    escalate_after_hours: 1,
    escalate_roles: ["owner"],
  });
  created.rules.push("pto.requested");

  // ---- 1. PTO requested → routed, filtered, sent with buttons ----
  const startDate = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const { data: to } = await admin
    .from("person_time_off")
    .insert({ person_id: subject.personId, kind: "pto", status: "requested", start_date: startDate, end_date: startDate, note: "e2e private note" })
    .select("id")
    .single();
  const timeOffId = (to as { id: string }).id;
  created.timeOff.push(timeOffId);

  slackCalls.length = 0;
  await notifyTimeOffRequested(timeOffId, null);
  const ptoEvent = await eventIdByKey(`pto.requested:${timeOffId}`);
  check("pto.requested event recorded", !!ptoEvent);
  const { data: ev1 } = await admin.from("notification_event").select("status, recipient_count, error").eq("id", ptoEvent).single();
  check("event processed", (ev1 as { status: string }).status === "done", ev1);

  const d1 = await deliveriesFor(ptoEvent);
  const byPerson = new Map(d1.map((d) => [d.recipient_person_id, d]));
  const schedDelivery = byPerson.get(sched.personId);
  check("schedule admin gets a DM, sent", schedDelivery?.status === "sent", schedDelivery);
  check("schedule admin's card has Approve/Deny", JSON.stringify(schedDelivery?.blocks).includes("pto.approve"));
  check("restricted: manager without Scheduling access excluded", !byPerson.has(noAccess.personId));
  check("named subject (no login) is a subject → included", byPerson.has(subject.personId));
  check("subject's copy has no approve buttons", !JSON.stringify(byPerson.get(subject.personId)?.blocks).includes("pto.approve"));
  check("non-subject copies require Scheduling at send time", schedDelivery?.required_module === "schedule");
  const noSlackDelivery = byPerson.get(noSlack.personId);
  check("schedule admin without Slack → skipped with reason", noSlackDelivery?.status === "skipped" && /slack/i.test(String(noSlackDelivery?.last_error)), noSlackDelivery);
  check("marketing admin not routed", !byPerson.has(mkt.personId));
  const { data: inbox } = await admin.from("user_notification").select("id").eq("event_id", ptoEvent).eq("recipient_user_id", sched.userId!);
  check("inbox row for the schedule admin login", (inbox ?? []).length === 1);
  const posted = slackCalls.filter((c) => c.method === "chat.postMessage");
  check("Slack received the DMs (mocked)", posted.some((c) => c.body.channel === sched.slackUserId));
  check("private note is in the admin DM (DM, not channel)", JSON.stringify(posted.find((c) => c.body.channel === sched.slackUserId)?.body).includes("e2e private note"));

  // ---- 2. idempotency ----
  const before = d1.length;
  await notifyTimeOffRequested(timeOffId, null);
  check("re-emitting the same request adds nothing", (await deliveriesFor(ptoEvent)).length === before);

  // ---- 3. Slack button: forbidden click, approve, retry, second click ----
  const res0 = await handleSlackAction({ slackUserId: noAccess.slackUserId, actionId: "pto.approve", deliveryId: schedDelivery!.id, actionTs: "1.1", responseUrl: null });
  void res0;
  const { data: forbidden } = await admin.from("notification_action").select("outcome").eq("slack_user_id", noAccess.slackUserId);
  check("someone else's DM button is refused", (forbidden as { outcome: string }[])[0]?.outcome === "forbidden", forbidden);
  const { data: stillReq } = await admin.from("person_time_off").select("status").eq("id", timeOffId).single();
  check("…and nothing changed", (stillReq as { status: string }).status === "requested");

  slackCalls.length = 0;
  await handleSlackAction({ slackUserId: sched.slackUserId, actionId: "pto.approve", deliveryId: schedDelivery!.id, actionTs: "2.2", responseUrl: null });
  const { data: approved } = await admin.from("person_time_off").select("status, reviewed_by").eq("id", timeOffId).single();
  check("approve from Slack updates the request", (approved as { status: string }).status === "approved", approved);
  check("reviewer recorded", (approved as { reviewed_by: string }).reviewed_by === sched.userId);
  check("sent card updated in place (chat.update)", slackCalls.some((c) => c.method === "chat.update" && JSON.stringify(c.body).includes("Approved by")));
  const approvedEvent = (await admin.from("notification_event").select("id").eq("event_type", "pto.approved").eq("subject_id", timeOffId).limit(1)).data?.[0]?.id as string;
  if (approvedEvent) created.events.push(approvedEvent);
  const dApproved = await deliveriesFor(approvedEvent);
  check("employee (no login) gets the approval DM", dApproved.some((d) => d.recipient_person_id === subject.personId && d.status === "sent"), dApproved);
  const { data: resolved } = await admin.from("notification_delivery").select("resolved_note").eq("id", schedDelivery!.id).single();
  check("original delivery marked resolved", /Approved by/.test(String((resolved as { resolved_note: string }).resolved_note)));

  const actionsBefore = (await admin.from("notification_action").select("id").eq("slack_user_id", sched.slackUserId)).data?.length ?? 0;
  await handleSlackAction({ slackUserId: sched.slackUserId, actionId: "pto.approve", deliveryId: schedDelivery!.id, actionTs: "2.2", responseUrl: null });
  const actionsAfter = (await admin.from("notification_action").select("id").eq("slack_user_id", sched.slackUserId)).data?.length ?? 0;
  check("Slack retry of the same click is a no-op", actionsAfter === actionsBefore);
  await handleSlackAction({ slackUserId: sched.slackUserId, actionId: "pto.deny", deliveryId: schedDelivery!.id, actionTs: "3.3", responseUrl: null });
  const { data: second } = await admin.from("notification_action").select("outcome").eq("slack_user_id", sched.slackUserId).eq("action", "pto.deny");
  check("a later Deny on a decided request does nothing", (second as { outcome: string }[])[0]?.outcome === "already_done", second);
  const { data: final } = await admin.from("person_time_off").select("status").eq("id", timeOffId).single();
  check("…request stays approved", (final as { status: string }).status === "approved");

  // ---- 4. batching + coalescing + digest ----
  await admin.from("notification_rule").insert([
    { event_type: "schedule.shift_changed", audience: { subjects: true }, batch_minutes: 10 },
    { event_type: "marketing.event_updated", audience: { subjects: true }, batch_minutes: 10 },
  ]);
  created.rules.push("schedule.shift_changed", "marketing.event_updated");
  const shift = (change: string, n: number) =>
    emitEvent({ type: "schedule.shift_changed", subjectType: "sched_week", subjectId: tag, subjectPersonIds: [subject.personId],
      payload: { weekId: tag, weekStart: "2026-10-18", personName: "Subject", change, shifts: [`shift ${n}`] }, dedupeKey: `${tag}:shift:${n}` });
  await shift("first change", 1);
  await shift("second change", 2);
  await emitEvent({ type: "marketing.event_updated", subjectType: "marketing_event", subjectId: tag, subjectPersonIds: [subject.personId],
    payload: { eventId: tag, name: "E2E Fair", dates: "Sat, Nov 7", changes: ["location"], staffNames: [] }, dedupeKey: `${tag}:mkt:1` });
  for (const k of [`${tag}:shift:1`, `${tag}:shift:2`, `${tag}:mkt:1`]) await eventIdByKey(k);
  const { data: pend } = await admin.from("notification_delivery").select("id, coalesce_key, blocks, status").eq("recipient_person_id", subject.personId).eq("batched", true);
  const pendingShift = (pend ?? []).filter((r) => String(r.coalesce_key).startsWith("shift:"));
  check("two shift changes coalesce into one pending DM", pendingShift.length === 1 && pendingShift[0].status === "pending", pend);
  check("…carrying the latest shifts", JSON.stringify(pendingShift[0]?.blocks).includes("shift 2"));
  check("nothing sent yet (batched)", !slackCalls.some((c) => JSON.stringify(c.body).includes("E2E Fair")));
  await admin.from("notification_delivery").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("recipient_person_id", subject.personId).eq("status", "pending");
  slackCalls.length = 0;
  await dispatchPendingDeliveries({ trigger: "manual" });
  const digestCalls = slackCalls.filter((c) => c.method === "chat.postMessage" && c.body.channel === subject.slackUserId);
  check("batched updates go out as ONE digest message", digestCalls.length === 1 && JSON.stringify(digestCalls[0]?.body).includes("2 updates"), digestCalls.map((c) => c.body.text));
  const { data: sentBatch } = await admin.from("notification_delivery").select("status").eq("recipient_person_id", subject.personId).eq("batched", true);
  check("both batched rows marked sent", (sentBatch ?? []).every((r) => r.status === "sent"), sentBatch);

  // ---- 5. send-time re-check: access removed before a held delivery goes out ----
  await admin.from("notification_rule").update({ batch_minutes: 5 }).eq("event_type", "pto.requested");
  const { data: to2 } = await admin.from("person_time_off")
    .insert({ person_id: subject.personId, kind: "pto", status: "requested", start_date: startDate, end_date: startDate })
    .select("id").single();
  const timeOff2 = (to2 as { id: string }).id;
  created.timeOff.push(timeOff2);
  await notifyTimeOffRequested(timeOff2, null);
  const pto2Event = await eventIdByKey(`pto.requested:${timeOff2}`);
  await admin.from("app_user").update({ module_access: { schedule: false } }).eq("id", sched.userId!);
  await admin.from("notification_delivery").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("event_id", pto2Event).eq("status", "pending");
  await dispatchPendingDeliveries({ trigger: "manual" });
  const d2 = await deliveriesFor(pto2Event);
  const s2 = d2.find((d) => d.recipient_person_id === sched.personId);
  check("access removed after routing → not sent", s2?.status === "skipped" && /access/i.test(String(s2?.last_error)), s2);
  await admin.from("app_user").update({ module_access: {} }).eq("id", sched.userId!);

  // ---- 6. escalation: still pending after the window → owner ----
  await admin.from("notification_event").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("id", pto2Event);
  await runProducers();
  const escId = await eventIdByKey(`escalation:${pto2Event}`);
  check("open request escalated once", !!escId);
  const dEsc = await deliveriesFor(escId);
  check("escalation reaches the owner, relabelled", dEsc.some((d) => d.recipient_person_id === owner.personId && /^Still waiting/.test(String(d.title))), dEsc.map((d) => d.title));
  check("escalation not sent to the original audience", !dEsc.some((d) => d.recipient_person_id === sched.personId));
  await runProducers();
  const { data: escCount } = await admin.from("notification_event").select("id").like("dedupe_key", `escalation:${pto2Event}%`);
  check("escalation is not repeated", (escCount ?? []).length === 1);
  // The approved request (#1) must never escalate.
  await admin.from("notification_event").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), escalated_at: null }).eq("id", ptoEvent);
  await runProducers();
  const { data: noEsc } = await admin.from("notification_event").select("id").eq("dedupe_key", `escalation:${ptoEvent}`);
  check("a decided request never escalates", (noEsc ?? []).length === 0);

  // ---- 7. disabled rule ----
  await admin.from("notification_rule").update({ enabled: false }).eq("event_type", "schedule.shift_changed");
  await shift("while off", 3);
  const offId = await eventIdByKey(`${tag}:shift:3`);
  const { data: offEv } = await admin.from("notification_event").select("status").eq("id", offId).single();
  check("disabled rule → event skipped, nothing delivered", (offEv as { status: string }).status === "skipped" && (await deliveriesFor(offId)).length === 0);

  // ---- 8. marketing: many staff at once (dedupe key stays within 200 chars) ----
  const extra = await Promise.all([1, 2, 3, 4].map((i) => makePerson(`Staff${i}`, null)));
  const mktId = crypto.randomUUID();
  extraSubjects.push(mktId);
  const futureDay = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await notifyMarketingEventSaved({
    before: null,
    after: {
      id: mktId, name: "E2E Fair", status: "planning", starts_on: futureDay, ends_on: null, arrival_time: "8:00 AM",
      departure_time: null, location: "Venice", clinic_served: null, parking_info: null,
      staff_ids: [subject.personId, ...extra.map((x) => x.personId)],
    },
    actorUserId: null,
  });
  const { data: staffEv } = await admin.from("notification_event").select("id, status, recipient_count").eq("event_type", "marketing.staff_assigned").eq("subject_id", mktId);
  check("assigning 5 staff at once still notifies all of them", (staffEv as { status: string; recipient_count: number }[])?.[0]?.recipient_count === 5, staffEv);

  // ---- 9. task completed DM is not swallowed by the card resolver ----
  await admin.from("notification_rule").insert({ event_type: "task.completed", deliver_dm: true, deliver_inbox: true });
  created.rules.push("task.completed");
  const { data: schedUser } = await admin.from("app_user").select("*").eq("id", sched.userId!).single();
  const { data: ownerUser } = await admin.from("app_user").select("*").eq("id", owner.userId!).single();
  const actorOf = (u: { id: string; email: string }) => ({ authId: u.id, email: u.email, appUser: u as never });
  const t = await tasks.createOpsTask(actorOf(ownerUser as { id: string; email: string }), {
    assigneeUserId: sched.userId!, title: `E2E task ${tag}`, details: null, dueDate: null, priority: "normal", href: "/", notifySlack: true,
  });
  check("task created", t.ok, t);
  const taskId = t.ok ? t.id : "";
  await tasks.setOpsTaskStatus(actorOf(schedUser as { id: string; email: string }), taskId, "done");
  await new Promise((r) => setTimeout(r, 1500));
  const { data: doneNotes } = await admin.from("user_notification").select("id").eq("task_id", taskId).eq("kind", "task.completed");
  const doneIds = ((doneNotes ?? []) as { id: string }[]).map((n) => n.id);
  const { data: doneDel } = await admin.from("notification_delivery").select("status, last_error, message_key").in("notification_id", doneIds);
  check("completion notice to the creator is queued, not skipped", (doneDel ?? []).length === 1 && (doneDel as { status: string }[])[0].status === "pending", doneDel);
  const { data: assignedDel } = await admin.from("notification_delivery").select("message_key, resolved_note").eq("message_key", `task:${taskId}`);
  check("the assignment card (with the button) is the one resolved", (assignedDel ?? []).length === 1 && /Completed/.test(String((assignedDel as { resolved_note: string }[])[0].resolved_note)), assignedDel);
} finally {
  // ---- cleanup ----
  const evs = [...new Set(created.events.filter(Boolean))];
  const { data: extraEv } = await admin.from("notification_event").select("id").in("subject_id", [...created.timeOff, tag, ...extraSubjects]);
  for (const e of (extraEv ?? []) as { id: string }[]) evs.push(e.id);
  const { data: esc } = await admin.from("notification_event").select("id").in("dedupe_key", evs.map((e) => `escalation:${e}`));
  for (const e of (esc ?? []) as { id: string }[]) evs.push(e.id);
  if (evs.length) {
    await admin.from("notification_action").delete().in("event_id", evs);
    await admin.from("user_notification").delete().in("event_id", evs);
    await admin.from("notification_delivery").delete().in("event_id", evs);
    await admin.from("notification_event").delete().in("id", evs);
  }
  const people = created.people;
  if (people.length) {
    const { data: links } = await admin.from("person_slack_link").select("slack_user_id").in("person_id", people);
    const ids = ((links ?? []) as { slack_user_id: string | null }[]).map((l) => l.slack_user_id).filter(Boolean) as string[];
    if (ids.length) await admin.from("notification_action").delete().in("slack_user_id", ids);
  }
  if (created.rules.length) await admin.from("notification_rule").delete().in("event_type", created.rules);
  if (created.timeOff.length) await admin.from("person_time_off").delete().in("id", created.timeOff);
  if (created.users.length) {
    await admin.from("ops_task").delete().in("assignee_user_id", created.users);
    await admin.from("user_notification").delete().in("recipient_user_id", created.users);
    await admin.from("app_user").delete().in("id", created.users);
  }
  if (people.length) {
    await admin.from("person_slack_link").delete().in("person_id", people);
    await admin.from("person").delete().in("id", people);
  }
  const { count } = await admin.from("person").select("id", { count: "exact", head: true }).eq("last_name", tag);
  console.log(`cleanup: ${count ?? "?"} synthetic people left`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
