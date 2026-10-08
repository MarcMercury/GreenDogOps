"use server";

import { revalidatePath } from "next/cache";
import { bookInvite, type BookResult } from "@/lib/ats/booking";

/** The candidate confirms a time on their scheduling link. */
export async function confirmInterview(token: string, startIso: string): Promise<BookResult> {
  const res = await bookInvite(token, startIso);
  if (res.ok) {
    revalidatePath("/ats");
    revalidatePath("/calendar");
  }
  return res;
}
