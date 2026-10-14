"use client";

import type { ActionMessage } from "@/features/scheduling/payroll/types/action-message";

/** One-line result shown beside a payroll control after its action returns. */
export function ActionNote({ msg }: { msg: ActionMessage }) {
  if (!msg) return null;
  return <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>;
}
