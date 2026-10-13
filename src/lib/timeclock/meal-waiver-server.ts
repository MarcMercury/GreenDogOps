import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  MEAL_WAIVER_DOCUMENT_IDS,
  MEAL_WAIVER_KINDS,
  MEAL_WAIVERS_LIVE_SETTING,
  type MealWaiverKind,
} from "./meal-waiver";

// Meal waivers: the seeded policy documents (current version) and a person's
// signatures. Service role; callers scope to the signed-in person (My Time)
// or gate the viewer (HR profile).

export interface WaiverDocument {
  kind: MealWaiverKind;
  documentId: string;
  title: string;
  versionId: string;
  versionNo: number;
  text: string;
}

export interface WaiverSignature {
  id: string;
  kind: MealWaiverKind;
  version_no: number;
  signer_name: string;
  signed_at: string;
  revoked_at: string | null;
}

export async function mealWaiversLive(): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("app_setting")
    .select("value")
    .eq("key", MEAL_WAIVERS_LIVE_SETTING)
    .maybeSingle();
  return (data as { value: unknown } | null)?.value === true;
}

/** The current version of each waiver document (null if missing or inactive). */
export async function getWaiverDocuments(): Promise<Partial<Record<MealWaiverKind, WaiverDocument>>> {
  const admin = createAdminClient();
  const ids = Object.values(MEAL_WAIVER_DOCUMENT_IDS);
  const { data: docs, error } = await admin
    .from("resource_document")
    .select("id, title, current_version, is_active")
    .in("id", ids);
  if (error) throw new Error(`Could not load the waiver documents: ${error.message}`);
  const out: Partial<Record<MealWaiverKind, WaiverDocument>> = {};
  for (const kind of MEAL_WAIVER_KINDS) {
    const doc = ((docs ?? []) as { id: string; title: string; current_version: number; is_active: boolean }[]).find(
      (d) => d.id === MEAL_WAIVER_DOCUMENT_IDS[kind],
    );
    if (!doc || !doc.is_active || doc.current_version < 1) continue;
    const { data: ver } = await admin
      .from("resource_document_version")
      .select("id, version_no, title, content_text")
      .eq("document_id", doc.id)
      .eq("version_no", doc.current_version)
      .maybeSingle();
    const v = ver as { id: string; version_no: number; title: string; content_text: string | null } | null;
    if (!v || !v.content_text?.trim()) continue;
    out[kind] = { kind, documentId: doc.id, title: v.title, versionId: v.id, versionNo: v.version_no, text: v.content_text };
  }
  return out;
}

export async function getWaiverSignatures(personId: string): Promise<WaiverSignature[]> {
  const { data, error } = await createAdminClient()
    .from("meal_waiver")
    .select("id, kind, version_no, signer_name, signed_at, revoked_at")
    .eq("person_id", personId)
    .order("signed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load meal waivers: ${error.message}`);
  return (data ?? []) as WaiverSignature[];
}
