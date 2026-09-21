"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchWelcomeGuests } from "../../../(app)/med-ops/medical-boards/actions";
import type { WelcomeGuest } from "@/lib/med-ops/types";

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

interface Layout {
  columns: number;
  rows: number;
  petSize: number;
  parentSize: number;
  gap: number;
  padX: number;
  padY: number;
  radius: number;
}

/** Widest name still allowed to drive the type size; outliers ellipsize. */
const NAME_CAP = 18;
/** Rough advance width per character for the weights used on the cards. */
const PET_CHAR = 0.6;
const PARENT_CHAR = 0.52;
/** A card is one pet line, one smaller parent line, and breathing room. */
const PARENT_RATIO = 0.48;
const CARD_HEIGHT_RATIO = 2.35;

const EMPTY_LAYOUT: Layout = {
  columns: 1,
  rows: 1,
  petSize: 32,
  parentSize: 16,
  gap: 16,
  padX: 16,
  padY: 12,
  radius: 16,
};

/**
 * Picks the column count that lets every pet share one screen at the largest
 * possible type, so the board never paginates however busy the day is.
 */
function fitLayout(
  width: number,
  height: number,
  names: { pet: string; parent: string | null }[],
): Layout {
  const count = names.length;
  if (count === 0 || width <= 0 || height <= 0) return EMPTY_LAYOUT;

  const petChars = Math.min(
    NAME_CAP,
    Math.max(...names.map((n) => n.pet.length), 4),
  );
  const parentChars = Math.min(
    NAME_CAP + 6,
    Math.max(...names.map((n) => (n.parent ? n.parent.length + 5 : 0)), 0),
  );
  const hasParent = parentChars > 0;

  let best = EMPTY_LAYOUT;
  let bestSize = 0;

  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const gap = Math.max(
      6,
      Math.min(width / columns, height / rows) * 0.12,
    );
    const innerW = (width - gap * (columns - 1)) / columns;
    const innerH = (height - gap * (rows - 1)) / rows;
    if (innerW <= 0 || innerH <= 0) continue;

    const byHeight = innerH / (hasParent ? CARD_HEIGHT_RATIO : 1.85);
    const byWidth = innerW / (petChars * PET_CHAR + 1.1);
    const byParentWidth = hasParent
      ? innerW / (parentChars * PARENT_CHAR * PARENT_RATIO + 1.1)
      : Number.POSITIVE_INFINITY;
    const petSize = Math.min(byHeight, byWidth, byParentWidth);
    if (petSize <= bestSize) continue;

    bestSize = petSize;
    best = {
      columns,
      rows,
      petSize,
      parentSize: petSize * PARENT_RATIO,
      gap,
      padX: petSize * 0.45,
      padY: petSize * 0.3,
      radius: Math.max(12, petSize * 0.5),
    };
  }

  const petSize = Math.min(best.petSize, height * 0.5);
  return { ...best, petSize, parentSize: petSize * PARENT_RATIO };
}

/**
 * The lobby Welcome Board: a chromeless, single-screen greeting for every pet
 * booked today at one clinic. It is projected onto the waiting-room TV, so it
 * carries pet and family names only — never anything clinical — and the type
 * scales to whatever the day's caseload happens to be.
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
  const [clock, setClock] = useState<string | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);

  const names = useMemo(
    () =>
      guests.map((g) => ({
        id: g.id,
        pet: petName(g.patient),
        parent: friendlyName(g.client),
      })),
    [guests],
  );

  const layout = useMemo(
    () => fitLayout(box.width, box.height, names),
    [box.width, box.height, names],
  );

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

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      className="flex h-screen w-screen flex-col overflow-hidden bg-white"
      style={{
        // TV overscan clips the outer few percent of the panel.
        padding: "2.5vh 2.5vw",
        backgroundImage: `radial-gradient(60vw circle at 0% 0%, ${LEAF}33, transparent 60%), radial-gradient(60vw circle at 100% 100%, ${LEAF}33, transparent 60%)`,
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-6">
        <Image
          src="/logo.jpg"
          alt="Green Dog Veterinary Center"
          width={1652}
          height={1465}
          priority
          className="w-auto mix-blend-multiply"
          style={{ height: "9vh" }}
        />
        <div className="text-right">
          <p
            className="font-semibold tracking-tight"
            style={{ color: DARK, fontSize: "2.6vh" }}
          >
            {locationName}
          </p>
          <p className="text-slate-500" style={{ fontSize: "2vh" }}>
            {prettyDate}
            {clock ? ` · ${clock}` : ""}
          </p>
        </div>
      </header>

      <div className="shrink-0 text-center" style={{ paddingTop: "1.5vh" }}>
        <h1
          className="font-black tracking-tight"
          style={{ color: DARK, fontSize: "6vh", lineHeight: 1.05 }}
        >
          Welcome to Green Dog!
        </h1>
        <p className="text-slate-500" style={{ fontSize: "2.4vh" }}>
          We are so happy to see you today
        </p>
      </div>

      <main
        ref={stageRef}
        className="min-h-0 flex-1 overflow-hidden"
        style={{ paddingTop: "2vh", paddingBottom: "1vh" }}
      >
        {names.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center text-center">
            <p className="font-bold" style={{ color: DARK, fontSize: "5vh" }}>
              Wagging tails all around
            </p>
            <p className="text-slate-500" style={{ fontSize: "3vh" }}>
              Our next happy patients will appear here.
            </p>
          </div>
        ) : (
          <div
            className="grid h-full w-full"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
              gap: `${layout.gap}px`,
            }}
          >
            {names.map((n) => (
              <div
                key={n.id}
                className="flex min-w-0 flex-col items-center justify-center overflow-hidden border-2 bg-white/80 text-center shadow-sm"
                style={{
                  borderColor: `${LEAF}cc`,
                  borderRadius: `${layout.radius}px`,
                  padding: `${layout.padY}px ${layout.padX}px`,
                }}
              >
                <p
                  className="w-full truncate font-extrabold tracking-tight"
                  style={{
                    color: DARK,
                    fontSize: `${layout.petSize}px`,
                    lineHeight: 1.1,
                  }}
                  title={n.pet}
                >
                  {n.pet}
                </p>
                {n.parent ? (
                  <p
                    className="w-full truncate text-slate-600"
                    style={{
                      fontSize: `${layout.parentSize}px`,
                      lineHeight: 1.25,
                    }}
                  >
                    with {n.parent}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-between">
        <p className="text-slate-400" style={{ fontSize: "1.8vh" }}>
          {names.length > 0
            ? `${names.length} happy ${names.length === 1 ? "pet" : "pets"} today`
            : ""}
        </p>
        <button
          type="button"
          onClick={goFullScreen}
          className="rounded-full border border-slate-200 px-4 py-1.5 text-slate-400 opacity-20 transition hover:opacity-100"
          style={{ fontSize: "1.6vh" }}
        >
          Full screen
        </button>
      </footer>
    </div>
  );
}
