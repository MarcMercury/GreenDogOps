"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWelcomeGuests } from "../../../(app)/med-ops/medical-boards/actions";
import type { WelcomeGuest } from "@/lib/med-ops/types";

/** Pets per screen, and how long each screen stays up on the TV. */
const PAGE_SIZE = 12;
const PAGE_MS = 15000;
/** The lobby screen runs unattended all day, so it re-reads the boards. */
const REFRESH_MS = 120000;

const DARK = "#1b4332";
const LEAF = "#a7ce73";

/** "Bailey, Sarah" and "Sarah Bailey" both greet as "Sarah Bailey". */
function friendlyName(raw: string | null): string | null {
  if (!raw) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const comma = name.indexOf(",");
  const flipped =
    comma > 0 ? `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}` : name;
  return flipped.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, "").trim() || null;
}

/** Pet names arrive quoted or suffixed with the family name — greet the pet. */
function petName(raw: string): string {
  const quoted = raw.match(/"([^"]+)"/);
  return (quoted ? quoted[1] : raw).replace(/\s+/g, " ").trim();
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}

/**
 * The lobby Welcome Board: a chromeless, self-rotating greeting for every pet
 * booked today at one clinic. It is projected onto the waiting-room TV, so it
 * carries pet and family names only — never anything clinical.
 */
export function WelcomeBoard({
  guests: initialGuests,
  locationId,
  locationName,
  date,
}: {
  guests: WelcomeGuest[];
  locationId: string;
  locationName: string;
  date: string;
}) {
  const [guests, setGuests] = useState(initialGuests);
  const [pageIndex, setPageIndex] = useState(0);
  const [clock, setClock] = useState<string | null>(null);

  const pages = useMemo(() => chunk(guests, PAGE_SIZE), [guests]);
  const page = pages[pageIndex % pages.length];

  const prettyDate = useMemo(
    () =>
      new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [date],
  );

  const refresh = useCallback(async () => {
    setGuests(await fetchWelcomeGuests(locationId, date));
  }, [locationId, date]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (pages.length < 2) return;
    const timer = setInterval(
      () => setPageIndex((i) => (i + 1) % pages.length),
      PAGE_MS,
    );
    return () => clearInterval(timer);
  }, [pages.length]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
      );
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const goFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-white"
      style={{
        backgroundImage: `radial-gradient(900px circle at 0% 0%, ${LEAF}33, transparent 60%), radial-gradient(900px circle at 100% 100%, ${LEAF}33, transparent 60%)`,
      }}
    >
      <header className="flex items-center justify-between gap-6 px-10 pt-8">
        <Image
          src="/logo.jpg"
          alt="Green Dog Veterinary Center"
          width={1652}
          height={1465}
          priority
          className="h-24 w-auto mix-blend-multiply xl:h-32"
        />
        <div className="text-right">
          <p
            className="text-2xl font-semibold tracking-tight xl:text-3xl"
            style={{ color: DARK }}
          >
            {locationName}
          </p>
          <p className="mt-1 text-lg text-slate-500 xl:text-xl">
            {prettyDate}
            {clock ? ` · ${clock}` : ""}
          </p>
        </div>
      </header>

      <div className="px-10 pt-6 text-center">
        <h1
          className="text-5xl font-black tracking-tight xl:text-7xl"
          style={{ color: DARK }}
        >
          Welcome to Green Dog!
        </h1>
        <p className="mt-2 text-xl text-slate-500 xl:text-2xl">
          We are so happy to see you today
        </p>
      </div>

      <main className="flex flex-1 items-center px-10 py-8">
        {guests.length === 0 ? (
          <div className="w-full text-center">
            <p className="text-4xl font-bold" style={{ color: DARK }}>
              Wagging tails all around
            </p>
            <p className="mt-3 text-2xl text-slate-500">
              Our next happy patients will appear here.
            </p>
          </div>
        ) : (
          <div className="grid w-full grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {page.map((g) => {
              const parent = friendlyName(g.client);
              return (
                <div
                  key={g.id}
                  className="rounded-3xl border-2 bg-white/80 px-6 py-6 text-center shadow-sm"
                  style={{ borderColor: `${LEAF}cc` }}
                >
                  <p
                    className="truncate text-4xl font-extrabold tracking-tight xl:text-5xl"
                    style={{ color: DARK }}
                    title={petName(g.patient)}
                  >
                    {petName(g.patient)}
                  </p>
                  {parent ? (
                    <p className="mt-2 truncate text-xl text-slate-600 xl:text-2xl">
                      with {parent}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between px-10 pb-8">
        <p className="text-lg text-slate-400">
          {guests.length > 0
            ? `${guests.length} happy ${guests.length === 1 ? "pet" : "pets"} today`
            : ""}
        </p>
        {pages.length > 1 ? (
          <div className="flex items-center gap-2" aria-hidden>
            {pages.map((_, i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full transition"
                style={{
                  backgroundColor:
                    i === pageIndex % pages.length ? DARK : `${LEAF}80`,
                }}
              />
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={goFullScreen}
          className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-400 opacity-30 transition hover:opacity-100"
        >
          Full screen
        </button>
      </footer>
    </div>
  );
}
