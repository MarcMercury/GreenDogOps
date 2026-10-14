import "server-only";
import { getCurrentUser } from "@/lib/auth/session";

/** The signed-in user as stamped onto schedule rows (`created_by`, change log). */
export async function actor(): Promise<{ id: string | null; email: string | null }> {
  const current = await getCurrentUser();
  return {
    id: current?.authId ?? null,
    email: current?.email ?? null,
  };
}
