"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ContactInput } from "@/lib/reporting/types";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function requireEzyvetEditor() {
  const current = await requireUser();
  if (!canEditModule(current.appUser, "ezyvet")) {
    throw new Error("You do not have permission to import contacts.");
  }
  return current;
}

/** Begin a contact import session; returns the new import id. */
export async function createContactImport(
  filename: string,
  totalRows: number,
  snapshotDate: string | null,
): Promise<{ ok: true; importId: string } | { ok: false; error: string }> {
  const current = await requireEzyvetEditor();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ezyvet_contact_import")
    .insert({
      filename,
      uploaded_by: current.authId,
      total_rows: totalRows,
      snapshot_date: snapshotDate,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to start import." };
  return { ok: true, importId: data.id as string };
}

/**
 * Upsert a batch of contacts (deduped on ezyvet_contact_id). Classifies each
 * row as new / updated (ezyVet modified-at changed) / unchanged, logs the
 * changes for trend reporting, and returns the per-batch counts.
 */
export async function pushContacts(
  importId: string,
  rows: ContactInput[],
): Promise<
  | { ok: true; created: number; updated: number; unchanged: number }
  | { ok: false; error: string }
> {
  await requireEzyvetEditor();
  if (!Array.isArray(rows) || rows.length === 0)
    return { ok: true, created: 0, updated: 0, unchanged: 0 };
  const admin = createAdminClient();

  const ids = rows.map((r) => r.ezyvet_contact_id);
  const { data: existing } = await admin
    .from("ezyvet_contact")
    .select("ezyvet_contact_id, ezyvet_modified_at")
    .in("ezyvet_contact_id", ids);
  const existingMap = new Map<string, string | null>(
    (existing ?? []).map((e) => [
      e.ezyvet_contact_id as string,
      (e.ezyvet_modified_at as string | null) ?? null,
    ]),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const changes: {
    ezyvet_contact_id: string;
    import_id: string;
    change_type: string;
    changed_fields: Record<string, unknown> | null;
  }[] = [];

  for (const r of rows) {
    if (!existingMap.has(r.ezyvet_contact_id)) {
      created++;
      changes.push({
        ezyvet_contact_id: r.ezyvet_contact_id,
        import_id: importId,
        change_type: "created",
        changed_fields: null,
      });
    } else {
      const prevModified = existingMap.get(r.ezyvet_contact_id) ?? null;
      const nextModified = r.ezyvet_modified_at ?? null;
      const changed =
        (prevModified ?? "").slice(0, 19) !== (nextModified ?? "").slice(0, 19);
      if (changed) {
        updated++;
        changes.push({
          ezyvet_contact_id: r.ezyvet_contact_id,
          import_id: importId,
          change_type: "updated",
          changed_fields: { ezyvet_modified_at: nextModified },
        });
      } else {
        unchanged++;
      }
    }
  }

  // Note: first_seen_at is deliberately omitted so it survives updates.
  const payload = rows.map((r) => ({
    ...r,
    last_import_id: importId,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from("ezyvet_contact")
    .upsert(payload, { onConflict: "ezyvet_contact_id" });
  if (error) return { ok: false, error: error.message };

  if (changes.length > 0) {
    await admin.from("ezyvet_contact_change").insert(changes);
  }

  return { ok: true, created, updated, unchanged };
}

/** Close out the contact import with the final tallies. */
export async function finalizeContactImport(
  importId: string,
  created: number,
  updated: number,
  unchanged: number,
): Promise<ActionResult> {
  await requireEzyvetEditor();
  const admin = createAdminClient();
  await admin
    .from("ezyvet_contact_import")
    .update({
      new_contacts: created,
      updated_contacts: updated,
      unchanged_contacts: unchanged,
      details: { created, updated, unchanged },
    })
    .eq("id", importId);
  revalidatePath("/ezyvet");
  revalidatePath("/reporting");
  return {
    ok: true,
    message: `${created.toLocaleString()} new · ${updated.toLocaleString()} updated · ${unchanged.toLocaleString()} unchanged.`,
  };
}

/** Wipe ALL ezyVet contact data (admin only, destructive). */
export async function resetContactData(): Promise<ActionResult> {
  await requireAdmin();
  const admin = createAdminClient();
  for (const table of [
    "ezyvet_contact_change",
    "ezyvet_contact",
    "ezyvet_contact_import",
  ]) {
    const { error } = await admin.from(table).delete().not("id", "is", null);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/ezyvet");
  revalidatePath("/reporting");
  return { ok: true, message: "All ezyVet contact data cleared." };
}
