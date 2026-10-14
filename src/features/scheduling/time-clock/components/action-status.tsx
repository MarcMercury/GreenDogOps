"use client";

/** The result line under a decision control: green on success, red on error. */
export function ActionStatus({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
      {result.text}
    </p>
  );
}
