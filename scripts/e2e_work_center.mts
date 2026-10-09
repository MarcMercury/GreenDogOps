// End-to-end check of the dashboard work center against STAGING only
// (refuses any other project). Creates synthetic logins/tasks/notifications,
// exercises assign → notify → Slack delivery gate → complete → inbound
// idempotency, then deletes everything it made. Never contacts Slack
// (SLACK_BOT_TOKEN is removed from the process). Needs migration 0230 on staging.
//
//   mkdir -p /tmp/stub/node_modules/server-only \
//     && echo '{"name":"server-only","main":"index.js"}' > /tmp/stub/node_modules/server-only/package.json \
//     && echo 'module.exports={}' > /tmp/stub/node_modules/server-only/index.js
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/e2e_work_center.mts
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".secrets/supabase-staging.env", "utf8").split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m![1], m![2].replace(/^["']|["']$/g, "")]),
);
if (!String(env.STAGING_SUPABASE_URL).includes("yzxcuiwklrmxarzjzukr")) throw new Error("not staging");
process.env.NEXT_PUBLIC_SUPABASE_URL = env.STAGING_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.STAGING_SERVICE_ROLE_KEY;
delete process.env.SLACK_BOT_TOKEN; delete process.env.SLACK_DM_LIVE; delete process.env.SLACK_WORKFLOW_WEBHOOK_URL;

const { createAdminClient } = await import("@/lib/supabase/admin");
const tasks = await import("@/lib/worklist/tasks");
const { dispatchPendingDeliveries } = await import("@/lib/notify/dispatch");
const { publishNotification } = await import("@/lib/notify/publish");
const { loadDashboard } = await import("@/lib/worklist/sources");
const { parseInboundTask } = await import("@/lib/worklist/inbound");
const admin = createAdminClient();

let failures = 0;
const check = (name: string, cond: unknown, extra?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra !== undefined ? " " + JSON.stringify(extra) : ""}`);
  if (!cond) failures++;
};

const tag0 = `e2e${Date.now()}`;
const synth = ["manager", "schedule_admin", "staff", "staff"].map((role, i) => ({
  id: crypto.randomUUID(), email: `${tag0}-${i}@example.invalid`, full_name: `E2E ${role} ${i}`, role, is_active: true, module_access: {},
}));
const ins = await admin.from("app_user").insert(synth).select("*");
if (ins.error) throw new Error(ins.error.message);
const users = ins.data!;
const [editor, other, staff, strangerU] = users;
console.log("users:", users.length, "editor role:", editor.role, "other role:", other.role, "staff?", !!staff);
const cu = (u: typeof editor) => ({ authId: u.id, email: u.email, appUser: u });
const created: string[] = [];
const tag = `E2E-${Date.now()}`;

try {
  // 1. editor assigns a task to someone else, with Slack DM requested
  const r1 = await tasks.createOpsTask(cu(editor), { assigneeUserId: other.id, title: `${tag} assigned`, details: null, dueDate: null, priority: "high", href: "/schedule", notifySlack: true });
  check("editor can assign to another user", r1.ok, r1);
  if (r1.ok) created.push(r1.id);
  const { data: n1 } = await admin.from("user_notification").select("id, kind, recipient_user_id, notification_delivery(status, last_error)").eq("task_id", r1.ok ? r1.id : "00000000-0000-0000-0000-000000000000");
  check("assignee got task.assigned notification", n1?.length === 1 && n1[0].kind === "task.assigned" && n1[0].recipient_user_id === other.id, n1);
  const del = (n1?.[0] as { notification_delivery?: { status: string }[] })?.notification_delivery?.[0];
  check("a Slack delivery row was recorded (pending or skipped:no link)", del && ["pending", "skipped"].includes(del.status), n1);

  // 2. staff can't assign to others
  if (staff) {
    const r2 = await tasks.createOpsTask(cu(staff), { assigneeUserId: other.id, title: `${tag} nope`, details: null, dueDate: null, priority: "normal", href: null, notifySlack: false });
    check("staff cannot assign to someone else", !r2.ok, r2);
    const r2b = await tasks.createOpsTask(cu(staff), { assigneeUserId: staff.id, title: `${tag} self`, details: null, dueDate: "2026-01-01", priority: "normal", href: null, notifySlack: false });
    check("staff can add a task for themselves", r2b.ok, r2b);
    if (r2b.ok) created.push(r2b.id);
  }

  // 3. unsafe link rejected
  const r3 = await tasks.createOpsTask(cu(editor), { assigneeUserId: editor.id, title: `${tag} bad`, details: null, dueDate: null, priority: "normal", href: "https://evil.com", notifySlack: false });
  check("unsafe link rejected", !r3.ok, r3);

  // 4. dispatcher with DMs off: nothing pending remains for our notification, nothing sent
  const d = await dispatchPendingDeliveries({ trigger: "manual" });
  check("dispatcher ran without sending", d.ok && d.counts.sent === 0, d);
  const { data: delAfter } = await admin.from("notification_delivery").select("status, last_error, notification:notification_id!inner(task_id)").eq("notification.task_id", r1.ok ? r1.id : "");
  check("delivery is skipped (gate off or no link), never sent", delAfter?.[0]?.status === "skipped", delAfter);

  // 5. stranger cannot close; assignee closes; creator notified
  const stranger = strangerU;
  if (stranger && r1.ok) {
    const r5 = await tasks.setOpsTaskStatus(cu(stranger), r1.id, "done");
    check("unrelated user cannot complete the task", !r5.ok, r5);
  }
  if (r1.ok) {
    const r6 = await tasks.setOpsTaskStatus(cu(other), r1.id, "done");
    check("assignee completes the task", r6.ok, r6);
    const { data: n2 } = await admin.from("user_notification").select("kind, recipient_user_id").eq("task_id", r1.id).eq("kind", "task.completed");
    check("creator notified of completion", n2?.length === 1 && n2[0].recipient_user_id === editor.id, n2);
    const { data: t } = await admin.from("ops_task").select("status, completed_at, completed_by_user_id").eq("id", r1.id).single();
    check("task stamped done", t?.status === "done" && !!t.completed_at && t.completed_by_user_id === other.id, t);
  }

  // 6. inbound from Slack: idempotent on external_id, assignee by email
  const p = parseInboundTask({ external_id: `${tag}-wf`, assignee_email: other.email, title: `${tag} from slack`, link: "https://green-dog-group.slack.com/archives/C0TEST/p1" });
  check("inbound payload parses", p.ok, p);
  if (p.ok) {
    const a = await tasks.createInboundTask(p.task);
    const b = await tasks.createInboundTask(p.task);
    check("inbound creates once", a.ok && !a.duplicate, a);
    check("inbound repeat is a duplicate of the same task", b.ok && b.duplicate && a.ok && b.id === a.id, b);
    if (a.ok) created.push(a.id);
    const { data: t } = await admin.from("ops_task").select("source, action_target, assignee_user_id").eq("id", a.ok ? a.id : "").single();
    check("inbound task is Slack-target and assigned", t?.source === "slack" && t.action_target === "slack" && t.assignee_user_id === other.id, t);
  }
  const unknown = parseInboundTask({ external_id: `${tag}-x`, assignee_email: "nobody-e2e@example.invalid", title: "x" });
  if (unknown.ok) {
    const u = await tasks.createInboundTask(unknown.task);
    check("inbound unknown assignee → 422", !u.ok && u.status === 422, u);
  }

  // 7. dedupe on publish
  const pub1 = await publishNotification({ recipientUserId: other.id, kind: "test.dedupe", title: `${tag} dedupe`, dedupeKey: `${tag}-k` });
  const pub2 = await publishNotification({ recipientUserId: other.id, kind: "test.dedupe", title: `${tag} dedupe`, dedupeKey: `${tag}-k` });
  check("same dedupe key → one notification", pub1.ok && pub2.ok && pub2.duplicate && pub1.id === pub2.id, [pub1, pub2]);
  const bad = await publishNotification({ recipientUserId: other.id, kind: "Bad Kind", title: "x" });
  check("bad kind rejected", !bad.ok);

  // 7b. connected recipient on the test allow-list, no bot token → claimed, then failed (never retried)
  const { data: person, error: pe } = await admin.from("person").insert({ status: "employee", first_name: "E2E", last_name: tag }).select("id").single();
  check("synthetic person created", !pe, pe);
  if (person) {
    await admin.from("app_user").update({ person_id: person.id }).eq("id", other.id);
    const slackId = "U0E2E" + String(Date.now()).slice(-6);
    const { error: le } = await admin.from("person_slack_link").insert({ person_id: person.id, status: "connected", slack_user_id: slackId, slack_team_id: "T0E2E" });
    check("synthetic slack link", !le, le);
    process.env.SLACK_DM_TEST_USER_IDS = slackId;
    const pub = await publishNotification({ recipientUserId: other.id, kind: "test.dm", title: `${tag} dm`, href: "/", slack: true });
    check("delivery queued for a connected user", pub.ok && pub.slack === "queued", pub);
    const d2 = await dispatchPendingDeliveries({ trigger: "manual" });
    const { data: dl } = await admin.from("notification_delivery").select("status, attempts, last_error").eq("notification_id", pub.ok ? pub.id : "").single();
    check("claimed once, failed on missing token, not retried", dl?.status === "failed" && dl.attempts === 1 && /SLACK_BOT_TOKEN/.test(dl.last_error ?? ""), { dl, d2 });
    const d3 = await dispatchPendingDeliveries({ trigger: "manual" });
    const { data: dl2 } = await admin.from("notification_delivery").select("attempts").eq("notification_id", pub.ok ? pub.id : "").single();
    check("a second run does not resend", dl2?.attempts === 1 && d3.counts.sent === 0, { dl2, d3 });
    const dashS = await loadDashboard({ ...other, person_id: person.id });
    check("Slack panel shows link + delivery", dashS.slack.link?.status === "connected" && dashS.slack.deliveries.some((x) => x.title === `${tag} dm` && x.status === "failed"), dashS.slack);
    delete process.env.SLACK_DM_TEST_USER_IDS;
    await admin.from("app_user").update({ person_id: null }).eq("id", other.id);
    await admin.from("person").delete().eq("id", person.id);
  }

  // 8. dashboard shows it to the assignee
  const dash = await loadDashboard(other);
  check("work-center tables present (staging is behind on 0215-0227, so module warnings are expected)", !dash.setupNeeded, { setup: dash.setupNeeded, w: dash.warnings });
  check("inbound task on the assignee's work list", dash.work.some((i) => i.title === `${tag} from slack` && i.target === "slack" && i.meta === "From a Slack workflow"));
  check("completed task is NOT on the work list", !dash.work.some((i) => i.title === `${tag} assigned`));
  check("notifications include ours", dash.notifications.items.some((n) => n.title.includes(tag)));
  console.log("reminders for", other.role, "current:", dash.reminders.current.length, "upcoming:", dash.reminders.upcoming.length);
  const dashE = await loadDashboard(editor);
  check("editor sees completion notification", dashE.notifications.items.some((n) => n.title.includes(`${tag} assigned`)));
} finally {
  await admin.from("user_notification").delete().like("title", `%${tag}%`);
  if (created.length) await admin.from("ops_task").delete().in("id", created);
  const { count } = await admin.from("ops_task").select("id", { count: "exact", head: true }).like("title", `${tag}%`);
  const { count: nc } = await admin.from("user_notification").select("id", { count: "exact", head: true }).like("title", `%${tag}%`);
  await admin.from("app_user").delete().in("id", users.map((u) => u.id));
  const { count: uc } = await admin.from("app_user").select("id", { count: "exact", head: true }).like("email", `${tag0}%`);
  console.log("cleanup: leftover tasks", count, "notifications", nc, "users", uc);
}
console.log(failures ? `E2E FAILED (${failures})` : "E2E OK");
process.exit(failures ? 1 : 0);
