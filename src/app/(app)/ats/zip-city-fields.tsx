"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeUsZip } from "@/lib/shared/zip";

type Status = "idle" | "loading" | "filled" | "not_found" | "error";

async function fetchCity(zip: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/ats/zip-city?zip=${zip}`, { signal });
  if (!res.ok) throw new Error(`ZIP lookup failed (${res.status})`);
  const body = (await res.json()) as { city?: string | null };
  return body.city ?? null;
}

/**
 * ZIP + City inputs for the ATS candidate forms. Typing a 5-digit ZIP looks up
 * the city and fills it in. A city someone typed by hand is never overwritten —
 * a one-click "Use …" suggestion is shown instead when the ZIP disagrees.
 */
export function ZipCityFields({
  zipName = "postal_code",
  cityName = "candidate_location",
  defaultZip,
  defaultCity,
  inputClassName,
  labelClassName,
}: {
  zipName?: string;
  cityName?: string;
  defaultZip?: string | null;
  defaultCity?: string | null;
  inputClassName: string;
  labelClassName: string;
}) {
  const [zip, setZip] = useState(defaultZip ?? "");
  const [city, setCity] = useState(defaultCity ?? "");
  const needsInitialLookup = !(defaultCity ?? "").trim() && normalizeUsZip(defaultZip) != null;
  const [status, setStatus] = useState<Status>(needsInitialLookup ? "loading" : "idle");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // The last value this component put in City, so a new ZIP can replace it.
  const autoFilled = useRef<string | null>(null);
  const cityRef = useRef(city);
  const inflight = useRef<AbortController | null>(null);

  function updateCity(next: string) {
    cityRef.current = next;
    setCity(next);
  }

  function applyResult(found: string | null) {
    if (!found) {
      setStatus("not_found");
      return;
    }
    const current = cityRef.current.trim();
    if (!current || current === autoFilled.current) {
      autoFilled.current = found;
      updateCity(found);
      setStatus("filled");
    } else {
      setStatus("idle");
      if (current.toLowerCase() !== found.toLowerCase()) setSuggestion(found);
    }
  }

  /** Look up `zipCode`, cancelling any lookup already in flight. */
  function startLookup(zipCode: string): AbortController {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    fetchCity(zipCode, ctrl.signal).then(
      (found) => {
        if (!ctrl.signal.aborted) applyResult(found);
      },
      () => {
        if (!ctrl.signal.aborted) setStatus("error");
      },
    );
    return ctrl;
  }

  function onZipChange(rawZip: string) {
    setSuggestion(null);
    const z = normalizeUsZip(rawZip);
    if (!z) {
      inflight.current?.abort();
      setStatus("idle");
      return;
    }
    setStatus("loading");
    startLookup(z);
  }

  // Existing records with a ZIP but no city get it filled on open.
  useEffect(() => {
    const z = normalizeUsZip(defaultZip);
    if (!needsInitialLookup || !z) return;
    const ctrl = startLookup(z);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const hint =
    status === "loading"
      ? "Looking up city…"
      : status === "filled"
        ? "Filled in from ZIP"
        : status === "not_found"
          ? "ZIP not found — type the city"
          : status === "error"
            ? "Couldn't look up the ZIP — type the city"
            : null;

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={labelClassName}>ZIP / postal code</span>
        <input
          name={zipName}
          value={zip}
          inputMode="numeric"
          autoComplete="postal-code"
          onChange={(e) => {
            const next = e.target.value;
            setZip(next);
            if (normalizeUsZip(next) !== normalizeUsZip(zip)) onZipChange(next);
          }}
          className={inputClassName}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClassName}>City</span>
        <input
          name={cityName}
          value={city}
          autoComplete="address-level2"
          placeholder="Auto-fills from ZIP"
          onChange={(e) => {
            updateCity(e.target.value);
            setSuggestion(null);
            if (status === "filled") setStatus("idle");
          }}
          className={inputClassName}
        />
        {suggestion ? (
          <span className="text-xs text-slate-500">
            ZIP is in {suggestion} —{" "}
            <button
              type="button"
              onClick={() => {
                autoFilled.current = suggestion;
                updateCity(suggestion);
                setSuggestion(null);
                setStatus("filled");
              }}
              className="font-medium text-emerald-700 hover:underline"
            >
              use this
            </button>
          </span>
        ) : (
          hint && <span className="text-xs text-slate-500">{hint}</span>
        )}
      </label>
    </>
  );
}
