// End-to-end check of native policy documents (migration 0235) against
// STAGING only (refuses any other project). Creates synthetic logins and an
// employee, then exercises create → restrict → notify → sign → HR record →
// edit → re-sign → access change → file version → stop, checking every
// permission boundary, and deletes everything it made (audit_log rows stay:
// that table is append-only).
//
//   mkdir -p /tmp/stub/node_modules/server-only \
//     && echo '{"name":"server-only","main":"index.js"}' > /tmp/stub/node_modules/server-only/package.json \
//     && echo 'module.exports={}' > /tmp/stub/node_modules/server-only/index.js
//   NODE_PATH=/tmp/stub/node_modules npx --yes tsx@4 scripts/e2e_policy_documents.mts
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
const docs = await import("@/lib/resources/documents");
const { loadPersonPolicyStatus, loadAudience } = await import("@/lib/resources/server");
const admin = createAdminClient();

let failures = 0;
const check = (name: string, cond: unknown, extra?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra !== undefined ? " " + JSON.stringify(extra) : ""}`);
  if (!cond) failures++;
};

const tag = `e2e-doc-${Date.now()}`;
const person = await admin
  .from("person")
  .insert({ first_name: "E2E", last_name: `Signer ${tag}`, status: "employee" })
  .select("id")
  .single();
if (person.error) throw new Error(person.error.message);
const personId = person.data.id as string;

const synth = [
  { role: "manager", person_id: null },
  { role: "staff", person_id: personId },
  { role: "staff", person_id: null },
  { role: "schedule_admin", person_id: null },
].map((u, i) => ({
  id: crypto.randomUUID(),
  email: `${tag}-${i}@example.invalid`,
  full_name: `E2E ${u.role} ${i}`,
  role: u.role,
  person_id: u.person_id,
  is_active: true,
  module_access: {},
}));
const ins = await admin.from("app_user").insert(synth).select("*");
if (ins.error) throw new Error(ins.error.message);
const [mgrU, signerU, otherStaffU, schedU] = ins.data!;
const cu = (u: typeof mgrU) => ({ authId: u.id, email: u.email, appUser: u });
const mgr = cu(mgrU), signer = cu(signerU), otherStaff = cu(otherStaffU);

const body = (text: string, extra: object[] = []) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: `${tag} policy` }] },
    { type: "paragraph", content: [{ type: "text", text }] },
    ...extra,
  ],
});

const docIds: string[] = [];
const storagePaths: string[] = [];
const notesFor = async (userId: string, docId: string) =>
  (await admin.from("user_notification").select("kind, read_at, href").eq("recipient_user_id", userId).like("dedupe_key", `resource:${docId}:%`)).data ?? [];

try {
  // 1. Staff cannot create documents.
  const denied = await docs.saveNativeDocumentAs(otherStaff, {
    title: "nope", category: "hr", content: body("x"), notify: false, requireSignature: false,
  });
  check("staff cannot create a document", !denied.ok);

  // 2. Manager creates a document only the signer may see, notifies, requires signature.
  const created = await docs.saveNativeDocumentAs(mgr, {
    title: `${tag} Uniform Policy`,
    category: "hr",
    description: "e2e",
    content: body("Wear scrubs zebra-unicorn-e2e.", [
      { type: "paragraph", content: [{ type: "text", text: "evil", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    ]),
    notify: true,
    requireSignature: true,
    access: { everyone: false, roles: [], viewerIds: [signerU.id] },
  });
  check("manager creates a restricted document", created.ok, created);
  if (!created.ok || !created.id) throw new Error("cannot continue");
  const id = created.id;
  docIds.push(id);

  const { data: d1 } = await admin.from("resource_document").select("*").eq("id", id).single();
  check("version 1, signature required from v1, roles []", d1.current_version === 1 && d1.require_signature && d1.signature_from_version === 1 && Array.isArray(d1.visible_roles) && d1.visible_roles.length === 0, d1);
  check("script link was stripped on save", !JSON.stringify(d1.content_json).includes("javascript:"));
  const { count: chunkCount } = await admin.from("resource_document_chunk").select("id", { count: "exact", head: true }).eq("document_id", id);
  check("text indexed for Ask Ziggy", (chunkCount ?? 0) > 0);

  check("signer got a sign-request notification", (await notesFor(signerU.id, id)).some((n) => n.kind === "resource.signature_requested" && n.href === `/resources/doc/${id}`));
  check("other staff got nothing", (await notesFor(otherStaffU.id, id)).length === 0);
  check("schedule admin got nothing", (await notesFor(schedU.id, id)).length === 0);
  check("the sender is not notified", (await notesFor(mgrU.id, id)).length === 0);

  // 3. Search respects access.
  const search = async (u: string) =>
    ((await admin.rpc("search_resource_content", { p_query: "zebra unicorn", p_app_user_id: u, p_limit: 5 })).data ?? []) as { document_id: string }[];
  check("Ziggy search finds it for the signer", (await search(signerU.id)).some((r) => r.document_id === id));
  check("Ziggy search hides it from other staff", !(await search(otherStaffU.id)).some((r) => r.document_id === id));

  // 4. Signing.
  check("someone without access cannot sign", !(await docs.signDocumentAs(otherStaff, { id, version: 1, initials: "OS" }, null)).ok);
  check("bad initials are rejected", !(await docs.signDocumentAs(signer, { id, version: 1, initials: "<b>" }, null)).ok);
  const signed = await docs.signDocumentAs(signer, { id, version: 1, initials: "es" }, "e2e-agent");
  check("signer signs version 1", signed.ok, signed);
  const again = await docs.signDocumentAs(signer, { id, version: 1, initials: "ES" }, null);
  check("signing twice is harmless", again.ok && /already/i.test(again.message ?? ""), again);
  const { data: sig } = await admin.from("resource_document_signature").select("*").eq("document_id", id).eq("app_user_id", signerU.id).single();
  check("signature recorded on the employee's person record", sig?.person_id === personId && sig?.initials === "ES" && sig?.version_no === 1, sig);
  check("sign-request notification marked read", (await notesFor(signerU.id, id)).every((n) => n.read_at));

  let status = await loadPersonPolicyStatus(admin, personId);
  check("HR record shows the signature as verified", status.signed.some((s) => s.document_id === id && s.current) && !status.pending.some((p) => p.document_id === id), status);

  // 5. Minor edit keeps signatures valid; concurrent edit is refused.
  const edit = await docs.saveNativeDocumentAs(mgr, {
    id, title: `${tag} Uniform Policy`, category: "hr", content: body("Wear clean scrubs zebra-unicorn-e2e."), notify: false, requireSignature: false, baseVersion: 1,
  });
  check("manager saves version 2 (no re-sign)", edit.ok, edit);
  const stale = await docs.saveNativeDocumentAs(mgr, {
    id, title: "stale", category: "hr", content: body("stale"), notify: false, requireSignature: false, baseVersion: 1,
  });
  check("a save from a stale editor is refused", !stale.ok && /someone else/i.test(stale.ok ? "" : stale.error), stale);
  status = await loadPersonPolicyStatus(admin, personId);
  check("v1 signature still counts after a minor edit", status.signed.some((s) => s.document_id === id && s.current));

  // 6. Re-send requiring signatures on v2.
  const resend = await docs.sendDocumentAs(mgr, { id, requireSignature: true, note: "Please re-sign" });
  check("manager re-sends v2 for signature", resend.ok && /Notified 1 person/.test(resend.ok ? resend.message ?? "" : ""), resend);
  status = await loadPersonPolicyStatus(admin, personId);
  check("employee now pending, old signature marked earlier version",
    status.pending.some((p) => p.document_id === id && p.version === 2) && status.signed.some((s) => s.document_id === id && !s.current), status);
  check("signing the outdated version is refused", !(await docs.signDocumentAs(signer, { id, version: 1, initials: "ES" }, null)).ok);
  check("signer signs version 2", (await docs.signDocumentAs(signer, { id, version: 2, initials: "ES" }, null)).ok);
  status = await loadPersonPolicyStatus(admin, personId);
  check("HR record shows v2 verified and nothing pending", !status.pending.some((p) => p.document_id === id) && status.signed.filter((s) => s.document_id === id).length === 2);

  // 7. Access change: open it to the Staff role.
  check("staff cannot change access", !(await docs.updateDocumentAccessAs(otherStaff, { id, everyone: true, roles: [], viewerIds: [] })).ok);
  const acc = await docs.updateDocumentAccessAs(mgr, { id, everyone: false, roles: ["staff"], viewerIds: [schedU.id] });
  check("manager opens it to Staff + one schedule admin", acc.ok, acc);
  const { data: d2 } = await admin.from("resource_document").select("id, visible_roles").eq("id", id).single();
  const audience = (await loadAudience(admin, d2!)).map((u) => u.id);
  check("audience now includes other staff and the named schedule admin",
    audience.includes(otherStaffU.id) && audience.includes(schedU.id) && audience.includes(signerU.id), audience.length);
  check("Ziggy search now finds it for other staff", (await search(otherStaffU.id)).some((r) => r.document_id === id));

  // 8. Stop requiring signatures; deleting is blocked while signatures exist.
  check("staff cannot stop signatures", !(await docs.stopSignatureRequirementAs(otherStaff, id)).ok);
  check("manager stops requiring signatures", (await docs.stopSignatureRequirementAs(mgr, id)).ok);
  const del = await admin.from("resource_document").delete().eq("id", id);
  check("database refuses to delete a signed document", !!del.error);

  // 9. Uploaded file: new version keeps the old file for the record.
  const pathV1 = `e2e/${tag}-v1.pdf`;
  const up = await admin.storage.from("resources").upload(pathV1, new Blob(["%PDF-1.4 e2e"], { type: "application/pdf" }), { contentType: "application/pdf" });
  check("staging upload works", !up.error, up.error);
  storagePaths.push(pathV1);
  const fileDoc = await admin
    .from("resource_document")
    .insert({ title: `${tag} file`, category: "hr", storage_path: pathV1, file_name: "v1.pdf", mime_type: "application/pdf", size_bytes: 12 })
    .select("id")
    .single();
  docIds.push(fileDoc.data!.id);
  const replaced = await docs.replaceDocumentFileAs(mgr, {
    id: fileDoc.data!.id,
    file: new File(["%PDF-1.4 e2e v2"], "v2.pdf", { type: "application/pdf" }),
    changeNote: "e2e",
    notify: false,
    requireSignature: true,
  });
  check("manager uploads a new file version with signature", replaced.ok, replaced);
  const { data: vers } = await admin.from("resource_document_version").select("version_no, storage_path, signature_required").eq("document_id", fileDoc.data!.id).order("version_no");
  for (const v of vers ?? []) if (v.storage_path) storagePaths.push(v.storage_path);
  check("legacy file got v1, new file is v2 requiring signature",
    vers?.length === 2 && vers[0].storage_path === pathV1 && vers[1].storage_path !== pathV1 && vers[1].signature_required, vers);
  const { data: fd } = await admin.from("resource_document").select("current_version, require_signature, signature_from_version, storage_path").eq("id", fileDoc.data!.id).single();
  if (fd?.storage_path) storagePaths.push(fd.storage_path);
  check("file document points at v2", fd?.current_version === 2 && fd.require_signature && fd.signature_from_version === 2, fd);
  check("staff cannot replace files", !(await docs.replaceDocumentFileAs(otherStaff, { id: fileDoc.data!.id, file: new File(["x"], "x.pdf"), changeNote: null, notify: false, requireSignature: false })).ok);
} finally {
  // Cleanup: signatures first (they block deletes), then documents, then people.
  for (const id of docIds) {
    await admin.from("resource_document_signature").delete().eq("document_id", id);
    await admin.from("user_notification").delete().like("dedupe_key", `resource:${id}:%`);
    await admin.from("resource_document").delete().eq("id", id);
  }
  if (storagePaths.length) await admin.storage.from("resources").remove([...new Set(storagePaths)]);
  await admin.from("app_user").delete().in("id", synth.map((u) => u.id));
  await admin.from("person").delete().eq("id", personId);
  const { count } = await admin.from("resource_document").select("id", { count: "exact", head: true }).like("title", `${tag}%`);
  check("cleanup removed every synthetic document", (count ?? 0) === 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
