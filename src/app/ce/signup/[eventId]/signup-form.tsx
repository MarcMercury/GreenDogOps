"use client";

import { useActionState } from "react";
import { submitCeSignup, type SignupResult } from "./actions";

export function CeSignupForm({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [result, formAction, pending] = useActionState<SignupResult | null, FormData>(
    (prev, fd) => submitCeSignup(eventId, prev, fd),
    null,
  );

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">You&apos;re on the list!</h2>
        <p className="mt-2 text-sm text-slate-600">
          Thanks for your interest in{" "}
          <span className="font-semibold text-slate-800">{eventName}</span>. We&apos;ll
          be in touch with the details.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-sm text-slate-500">Register your interest in</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{eventName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your details below and we&apos;ll add you to the interest list.
      </p>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Full name</span>
          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Phone number</span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>

      {result?.ok === false && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "I'm interested"}
      </button>
    </form>
  );
}
