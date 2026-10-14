"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a section takes to open or close (matches `grid.module.css`). */
export const SECTION_TRANSITION_MS = 220;

export type SectionState = "open" | "opening" | "closing";

/**
 * Lets a collapsible section animate: opening sections mount their rows at
 * once and play the expand animation; closing sections keep their rows
 * mounted, play the collapse animation, and only then apply the state change
 * that removes them. Keys are department ids (and "pto").
 */
export function useSectionTransitions(durationMs = SECTION_TRANSITION_MS) {
  const [opening, setOpening] = useState<ReadonlySet<string>>(() => new Set());
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const schedule = useCallback(
    (key: string, fn: () => void) => {
      const prior = timers.current.get(key);
      if (prior) clearTimeout(prior);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          fn();
        }, durationMs),
      );
    },
    [durationMs],
  );

  const expand = useCallback(
    (key: string, apply: () => void) => {
      setClosing((prev) => without(prev, key));
      apply();
      setOpening((prev) => withKey(prev, key));
      schedule(key, () => setOpening((prev) => without(prev, key)));
    },
    [schedule],
  );

  const collapse = useCallback(
    (key: string, apply: () => void) => {
      setOpening((prev) => without(prev, key));
      setClosing((prev) => withKey(prev, key));
      schedule(key, () => {
        apply();
        setClosing((prev) => without(prev, key));
      });
    },
    [schedule],
  );

  const stateOf = useCallback(
    (key: string): SectionState => (closing.has(key) ? "closing" : opening.has(key) ? "opening" : "open"),
    [closing, opening],
  );

  return { expand, collapse, stateOf, opening, closing };
}

function withKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (set.has(key)) return set;
  const next = new Set(set);
  next.add(key);
  return next;
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}
