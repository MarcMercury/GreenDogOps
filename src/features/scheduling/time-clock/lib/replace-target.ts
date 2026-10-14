import { ERRORS } from "@/features/scheduling/time-clock/lib/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReplaceTarget {
  replacePunchId: string | null;
  replaceAdjustmentId: string | null;
}

/**
 * Split the dropdown value of a "wrong time" correction (`"punch:<uuid>"` or
 * `"adjustment:<uuid>"`) into the RPC's two replace parameters. Blank means
 * nothing is replaced (the RPC then decides whether a target was required).
 */
export function parseReplaceTarget(
  replaceTarget: string | null,
): { ok: true; target: ReplaceTarget } | { ok: false; error: string } {
  const target: ReplaceTarget = { replacePunchId: null, replaceAdjustmentId: null };
  if (!replaceTarget) return { ok: true, target };
  const [kind, id] = replaceTarget.split(":");
  if (!UUID.test(id ?? "")) return { ok: false, error: ERRORS.replace_target_invalid };
  if (kind === "punch") target.replacePunchId = id;
  else if (kind === "adjustment") target.replaceAdjustmentId = id;
  else return { ok: false, error: ERRORS.replace_target_invalid };
  return { ok: true, target };
}
