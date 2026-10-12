"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import {
  replaceDocumentFileAs,
  saveNativeDocumentAs,
  sendDocumentAs,
  signDocumentAs,
  stopSignatureRequirementAs,
  updateDocumentAccessAs,
  type AccessInput,
  type DocActionResult,
  type SaveNativeInput,
} from "@/lib/resources/documents";

export type { DocActionResult } from "@/lib/resources/documents";

const NOT_SIGNED_IN: DocActionResult = { ok: false, error: "Not signed in." };

function revalidateDocument(id: string | undefined) {
  revalidatePath("/resources");
  if (id) revalidatePath(`/resources/doc/${id}`);
}

export async function saveNativeDocument(input: SaveNativeInput): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const res = await saveNativeDocumentAs(current, input);
  if (res.ok) revalidateDocument(res.id);
  return res;
}

export async function replaceDocumentFile(
  _prev: DocActionResult | null,
  formData: FormData,
): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : null;
  };
  const res = await replaceDocumentFileAs(current, {
    id: str("id"),
    file: formData.get("file"),
    changeNote: str("change_note"),
    notify: formData.get("notify") === "on",
    requireSignature: formData.get("require_signature") === "on",
  });
  if (res.ok) revalidateDocument(res.id);
  return res;
}

export async function sendDocument(input: {
  id: string;
  requireSignature: boolean;
  note?: string | null;
}): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const res = await sendDocumentAs(current, input);
  if (res.ok) revalidateDocument(input.id);
  return res;
}

export async function stopSignatureRequirement(id: string): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const res = await stopSignatureRequirementAs(current, id);
  if (res.ok) revalidateDocument(id);
  return res;
}

export async function updateDocumentAccess(input: AccessInput): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const res = await updateDocumentAccessAs(current, input);
  if (res.ok) revalidateDocument(input.id);
  return res;
}

export async function signDocument(input: {
  id: string;
  version: number;
  initials: string;
}): Promise<DocActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const res = await signDocumentAs(current, input, (await headers()).get("user-agent"));
  if (res.ok) {
    revalidateDocument(input.id);
    if (current.appUser.person_id) revalidatePath(`/hr/${current.appUser.person_id}`);
  }
  return res;
}
