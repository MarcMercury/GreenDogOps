"use server";

import { allowPublicSubmission, TOO_MANY_MESSAGE } from "@/lib/security/rate-limit";
import { revalidatePath } from "next/cache";
import { bookInvite, type BookResult } from "@/lib/ats/booking";

/** The candidate confirms a time on their scheduling link. */
export async function confirmInterview(token: string, startIso: string): Promise<BookResult> {
  if (!(await allowPublicSubmission("book", 20))) return { ok: false, error: TOO_MANY_MESSAGE };
  const res = await bookInvite(token, startIso);
  if (res.ok) {
    revalidatePath("/ats");
    revalidatePath("/calendar");
  }
  return res;
}
