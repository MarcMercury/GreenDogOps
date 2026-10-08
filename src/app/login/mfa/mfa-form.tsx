"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmMfaEnrollment,
  startMfaEnrollment,
  verifyMfaCode,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";
const buttonClass =
  "w-full rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60";

export function MfaForm({
  mode,
  factorId,
}: {
  mode: "challenge" | "enroll";
  factorId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);

  const router = useRouter();
  // The server action already set the upgraded (AAL2) session cookies.
  const done = () => {
    router.replace("/");
    router.refresh();
  };

  if (mode === "enroll" && !enrollment) {
    return (
      <div className="space-y-4">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <p className="text-sm text-slate-600">
          Install an authenticator app (Google Authenticator, Microsoft
          Authenticator, 1Password, Authy…) on your phone, then continue.
        </p>
        <button
          type="button"
          disabled={pending}
          className={buttonClass}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await startMfaEnrollment();
              if (res.ok) setEnrollment(res);
              else setError(res.error);
            })
          }
        >
          {pending ? "Starting…" : "Set up authenticator app"}
        </button>
      </div>
    );
  }

  const activeFactor = mode === "enroll" ? enrollment?.factorId ?? null : factorId;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!activeFactor) return;
        startTransition(async () => {
          setError(null);
          const res =
            mode === "enroll"
              ? await confirmMfaEnrollment(activeFactor, code)
              : await verifyMfaCode(activeFactor, code);
          if (res.ok) done();
          else setError(res.error);
        });
      }}
    >
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {mode === "enroll" && enrollment ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">
            Scan this QR code with your authenticator app.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL SVG from Supabase */}
          <img
            src={enrollment.qrCode}
            alt="Authenticator QR code"
            className="mx-auto h-44 w-44 rounded-lg border border-slate-200 bg-white p-2"
          />
          <p className="text-xs text-slate-500">
            Can&apos;t scan? Enter this key:{" "}
            <code className="select-all break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
              {enrollment.secret}
            </code>
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor="mfa-code" className="mb-1 block text-sm font-medium text-slate-700">
          6-digit code
        </label>
        <input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending || !activeFactor} className={buttonClass}>
        {pending ? "Verifying…" : mode === "enroll" ? "Turn on two-step verification" : "Verify"}
      </button>
    </form>
  );
}
