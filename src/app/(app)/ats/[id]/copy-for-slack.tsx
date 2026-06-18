"use client";

import { useState } from "react";

/**
 * A small "copy to clipboard" button used to grab Slack-ready summaries.
 *
 * `getText` is called on click so the latest props/state are captured at the
 * moment the user copies.
 */
export function CopyForSlackButton({
  getText,
  label = "Copy for Slack",
  className,
}: {
  getText: () => string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = getText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: surface the text so the user can copy manually.
      window.prompt("Copy this summary:", text);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      }
    >
      {copied ? "Copied ✓" : `💬 ${label}`}
    </button>
  );
}
