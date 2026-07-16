"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type MarketingTreeNode,
  type InitiativeLink,
  type TreeItem,
  type PersonOption,
  type MarketingGoal,
  type MarketingInitiative,
  type MarketingEvent,
  TREE_ZONES,
  NODE_STATUSES,
  ITEM_STATUSES,
  PRIORITIES,
  EVENT_TYPES,
  APP_DESTINATIONS,
  destinationForUrl,
  suggestDestinations,
  nodeStatusLabel,
  itemStatusLabel,
  treeZoneLabel,
  priorityLabel,
  personLabel,
  initiativeStatusLabel,
  eventTypeLabel,
} from "@/lib/marketing/types";
import {
  saveTreeNode,
  setTreeNodeStatus,
  deleteTreeNode,
  markNodeHandled,
  searchCrmRecords,
  type CrmRecordHit,
  type ActionResult,
} from "./actions";
import { OwnerSelect } from "./owner-select";

// ---------------------------------------------------------------------------
// Canvas geometry — vertical bands are fixed; the canvas WIDTH grows with the
// number of leaves so nothing overlaps (the SVG scrolls horizontally).
// ---------------------------------------------------------------------------
const H = 1300;
const GROUND_Y = 820;
const TRUNK_HALF = 44;
const TRUNK_TOP_Y = 520;
// Horizontal step between adjacent leaf columns. Nodes cycle through THREE
// staggered rows per band, so nodes in the SAME row are 3×COL apart while
// adjacent columns sit on different vertical planes — this lets the columns
// pack very tightly yet stay fully readable without overlap.
const COL = 76;
const MARGIN = 60;
// Three staggered y-rows per band (nodes cycle by column index % 3). Outer
// nodes land on different vertical planes so they never collide.
const CANOPY_ROWS = [118, 180, 242];
const BRANCH_ROWS = [366, 424, 482];
const PRIMARY_ROWS = [900, 962, 1024];
const FINE_ROWS = [1092, 1154, 1216];
const PLANES = 3;

// Node label typography / pill sizing (labels wrap onto up to two lines so the
// tree stays horizontally compact).
const NODE_FONT = 11.5;
const CHAR_W = 6.3; // approx advance width per character at NODE_FONT
const PILL_PAD_X = 20;
const PILL_PAD_Y = 7;
const LINE_H = 13;
const MAX_LINE_CHARS = 16;
const MIN_PILL_W = 78;
const MAX_PILL_W = MAX_LINE_CHARS * CHAR_W + PILL_PAD_X + 8;

const SKY = "#EAF2F0";
const SOIL = "#3E3128";
const SOIL_DEEP = "#2E2219";
const BARK = "#6B4F3A";

const STATUS_FILL: Record<string, string> = {
  active: "#16a34a",
  needs_attention: "#f59e0b",
  planning: "#3b82f6",
  dormant: "#94a3b8",
  archived: "#cbd5e1",
};

// Zone visual styling for the node "cards" drawn on the SVG.
const ZONE_STYLE: Record<
  string,
  { fill: string; text: string; w: number; h: number; rx: number }
> = {
  canopy: { fill: "#9ED4A3", text: "#14532d", w: 132, h: 30, rx: 15 },
  branch: { fill: "#3E7D46", text: "#ffffff", w: 156, h: 34, rx: 17 },
  trunk: { fill: "#EFE7D5", text: "#3b2f22", w: 156, h: 32, rx: 8 },
  root_primary: { fill: "#E8DFC9", text: "#4a3a28", w: 156, h: 32, rx: 8 },
  root_fine: { fill: "#D8CDB2", text: "#4a3a28", w: 132, h: 28, rx: 8 },
};

// ---------------------------------------------------------------------------
// Seasonal freshness palette — a node's colour reflects how long since it was
// last handled, so neglected areas stand out at a glance. Leaves run spring →
// winter (green → pale green → orange → red); roots run healthy → decaying
// (reddish-brown → light brown → dark brown → grey).
// ---------------------------------------------------------------------------
// Day cut-offs for freshness buckets 0,1,2 (anything older, or never handled,
// falls into bucket 3).
const SEASON_CUTOFFS = [14, 45, 90] as const;
const SEASON_LABELS = ["Fresh", "Aging", "Stale", "Overdue"] as const;

const SEASON_LEAF: { fill: string; text: string }[] = [
  { fill: "#3E9E4A", text: "#ffffff" }, // green — spring
  { fill: "#B7DE8A", text: "#2f5d34" }, // pale green — summer
  { fill: "#E8912A", text: "#3d2400" }, // orange — autumn
  { fill: "#D64545", text: "#ffffff" }, // red — winter
];

const SEASON_ROOT: { fill: string; text: string }[] = [
  { fill: "#A65233", text: "#ffffff" }, // reddish brown — healthy
  { fill: "#C9A26B", text: "#3b2a18" }, // light brown
  { fill: "#5C3A22", text: "#f5ece0" }, // dark brown
  { fill: "#9A968C", text: "#242019" }, // greyish — dormant
];

const LEAF_ZONES = new Set(["canopy"]);
const ROOT_ZONES = new Set(["root_primary", "root_fine"]);

/** Bucket a node's last-handled timestamp into a 0–3 freshness tier. */
function seasonBucket(iso: string | null): 0 | 1 | 2 | 3 {
  if (!iso) return 3;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= SEASON_CUTOFFS[0]) return 0;
  if (days <= SEASON_CUTOFFS[1]) return 1;
  if (days <= SEASON_CUTOFFS[2]) return 2;
  return 3;
}

/** Seasonal fill/text for a leaf or root node; null for structural zones. */
function seasonStyle(
  zone: string,
  iso: string | null,
): { fill: string; text: string; bucket: number } | null {
  const b = seasonBucket(iso);
  if (LEAF_ZONES.has(zone)) return { ...SEASON_LEAF[b], bucket: b };
  if (ROOT_ZONES.has(zone)) return { ...SEASON_ROOT[b], bucket: b };
  return null;
}

/** Headline word for an aggregate freshness score (0–100). */
function healthLabel(score: number): string {
  if (score >= 80) return "Thriving";
  if (score >= 60) return "Healthy";
  if (score >= 40) return "Needs care";
  return "Overgrown";
}

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

interface Positioned {
  node: MarketingTreeNode;
  x: number;
  y: number;
  w: number; // dynamic pill width sized to the wrapped label
  h: number; // dynamic pill height (grows with the number of wrapped lines)
  lines: string[]; // label wrapped onto one or two lines
  pathD: string | null; // connector from parent/anchor to this node
}

/**
 * Wrap a label onto at most two lines and size the pill to fit. Keeping labels
 * narrow (wrapping instead of growing sideways) is what lets the columns pack
 * closely together.
 */
function layoutLabel(label: string): { lines: string[]; w: number; h: number } {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && candidate.length > MAX_LINE_CHARS) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push(label);
  // Collapse to a maximum of two lines; overflow is truncated on the last line.
  if (lines.length > 2) {
    const rest = lines.slice(1).join(" ");
    lines.length = 1;
    lines.push(truncate(rest, MAX_LINE_CHARS + 2));
  }
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const w = clamp(longest * CHAR_W + PILL_PAD_X, MIN_PILL_W, MAX_PILL_W);
  const h = lines.length * LINE_H + PILL_PAD_Y * 2;
  return { lines, w, h };
}

type Run = (action: () => Promise<ActionResult>, after?: () => void) => void;

// ---------------------------------------------------------------------------
// Layout — a wide, centered, two-row-per-band column spread. Every leaf gets
// its own column; siblings sit next to their parent; nothing overlaps.
// ---------------------------------------------------------------------------
function computeLayout(nodes: MarketingTreeNode[]): {
  positioned: Positioned[];
  byId: Map<string, Positioned>;
  width: number;
  height: number;
  centerX: number;
} {
  const byId = new Map<string, Positioned>();
  const positioned: Positioned[] = [];
  const push = (p: Positioned) => {
    positioned.push(p);
    byId.set(p.node.id, p);
  };

  const bySort = (a: MarketingTreeNode, b: MarketingTreeNode) =>
    a.sort_order - b.sort_order || a.label.localeCompare(b.label);

  const branches = nodes.filter((n) => n.zone === "branch").sort(bySort);
  const trunks = nodes.filter((n) => n.zone === "trunk").sort(bySort);
  const proots = nodes.filter((n) => n.zone === "root_primary").sort(bySort);
  const canopyOf = (id: string) =>
    nodes.filter((n) => n.zone === "canopy" && n.parent_id === id).sort(bySort);
  const fineOf = (id: string) =>
    nodes.filter((n) => n.zone === "root_fine" && n.parent_id === id).sort(bySort);

  // --- Assign columns for the canopy band (branches + their canopy leaves) ---
  let col = 0;
  const branchCenterCol = new Map<string, number>();
  const canopyCol = new Map<string, number>();
  for (const b of branches) {
    const kids = canopyOf(b.id);
    if (kids.length === 0) {
      branchCenterCol.set(b.id, col);
      col += 1;
    } else {
      const start = col;
      for (const k of kids) {
        canopyCol.set(k.id, col);
        col += 1;
      }
      branchCenterCol.set(b.id, (start + col - 1) / 2);
    }
  }
  // Orphan canopy (no branch parent) get their own trailing columns.
  const orphanCanopy = nodes.filter(
    (n) => n.zone === "canopy" && !canopyCol.has(n.id),
  );
  for (const k of orphanCanopy) {
    canopyCol.set(k.id, col);
    col += 1;
  }
  const canopyColCount = Math.max(col, 1);

  // --- Assign columns for the root band (primary roots + fine roots) ---
  let rcol = 0;
  const rootCenterCol = new Map<string, number>();
  const fineCol = new Map<string, number>();
  for (const p of proots) {
    const kids = fineOf(p.id);
    if (kids.length === 0) {
      rootCenterCol.set(p.id, rcol);
      rcol += 1;
    } else {
      const start = rcol;
      for (const k of kids) {
        fineCol.set(k.id, rcol);
        rcol += 1;
      }
      rootCenterCol.set(p.id, (start + rcol - 1) / 2);
    }
  }
  const orphanFine = nodes.filter(
    (n) => n.zone === "root_fine" && !fineCol.has(n.id),
  );
  for (const k of orphanFine) {
    fineCol.set(k.id, rcol);
    rcol += 1;
  }
  const rootColCount = Math.max(rcol, 1);

  // --- Canvas sizing: wide enough for the busier of the two bands ---
  const cols = Math.max(canopyColCount, rootColCount, 6);
  const width = cols * COL + 2 * MARGIN;
  const centerX = width / 2;
  const canopyLeft = (width - canopyColCount * COL) / 2 + COL / 2;
  const rootLeft = (width - rootColCount * COL) / 2 + COL / 2;
  const cX = (c: number) => canopyLeft + c * COL;
  const rX = (c: number) => rootLeft + c * COL;

  // --- Branches ---
  branches.forEach((b, bi) => {
    const x = cX(branchCenterCol.get(b.id) ?? 0);
    const y = BRANCH_ROWS[bi % PLANES];
    const midY = (TRUNK_TOP_Y + y) / 2;
    const pathD = `M ${centerX} ${TRUNK_TOP_Y} C ${centerX} ${midY}, ${x} ${midY}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(b.label);
    push({ node: b, x, y, w, h, lines, pathD });
  });

  // --- Canopy leaves ---
  for (const k of nodes.filter((n) => n.zone === "canopy" && canopyCol.has(n.id))) {
    const c = canopyCol.get(k.id)!;
    const x = cX(c);
    const y = CANOPY_ROWS[c % PLANES];
    const parent = k.parent_id ? byId.get(k.parent_id) : undefined;
    const anchorX = parent?.x ?? centerX;
    const anchorY = parent?.y ?? TRUNK_TOP_Y;
    const pathD = `M ${anchorX} ${anchorY} Q ${(anchorX + x) / 2} ${(anchorY + y) / 2}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(k.label);
    push({ node: k, x, y, w, h, lines, pathD });
  }

  // --- Trunk plaques ---
  const topY = TRUNK_TOP_Y + 42;
  const botY = GROUND_Y - 28;
  trunks.forEach((n, k) => {
    const step = (botY - topY) / Math.max(trunks.length, 1);
    const y = topY + k * step + step / 2;
    const { lines, w, h } = layoutLabel(n.label);
    push({ node: n, x: centerX, y, w, h, lines, pathD: null });
  });

  // --- Primary roots ---
  proots.forEach((p, pi) => {
    const x = rX(rootCenterCol.get(p.id) ?? 0);
    const y = PRIMARY_ROWS[pi % PLANES];
    const midY = (GROUND_Y + y) / 2;
    const pathD = `M ${centerX} ${GROUND_Y} C ${centerX} ${midY}, ${x} ${midY}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(p.label);
    push({ node: p, x, y, w, h, lines, pathD });
  });

  // --- Fine roots ---
  for (const k of nodes.filter((n) => n.zone === "root_fine" && fineCol.has(n.id))) {
    const c = fineCol.get(k.id)!;
    const x = rX(c);
    const y = FINE_ROWS[c % PLANES];
    const parent = k.parent_id ? byId.get(k.parent_id) : undefined;
    const anchorX = parent?.x ?? centerX;
    const anchorY = parent?.y ?? GROUND_Y;
    const pathD = `M ${anchorX} ${anchorY} Q ${(anchorX + x) / 2} ${(anchorY + y) / 2}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(k.label);
    push({ node: k, x, y, w, h, lines, pathD });
  }

  return { positioned, byId, width, height: H, centerX };
}

// ===========================================================================
// Marketing Tree
// ===========================================================================
export function MarketingTree({
  canEdit,
  nodes,
  people,
  goals,
  initiatives,
  events,
}: {
  canEdit: boolean;
  nodes: MarketingTreeNode[];
  people: PersonOption[];
  goals: MarketingGoal[];
  initiatives: MarketingInitiative[];
  events: MarketingEvent[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<MarketingTreeNode | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusZone, setFocusZone] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<MarketingTreeNode | { zone: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Zoom: scale factor applied to the native SVG size. "Fit" sizes the tree so
  // the whole canvas is visible within the scroll container.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }
  const run: Run = (action, after) => {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  const visibleNodes = useMemo(
    () => nodes.filter((n) => showArchived || n.status !== "archived"),
    [nodes, showArchived],
  );

  const { positioned, byId, width, height, centerX } = useMemo(
    () => computeLayout(visibleNodes),
    [visibleNodes],
  );

  const ZOOM_MIN = 0.15;
  const ZOOM_MAX = 2;
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const padding = 24;
    const availW = el.clientWidth - padding;
    const availH = el.clientHeight - padding;
    if (availW <= 0 || availH <= 0) return;
    setZoom(clampZoom(Math.min(availW / width, availH / height)));
  }, [width, height]);

  // Default view: condensed but READABLE. Fit to width, but never shrink below
  // a legible floor — then centre horizontally on the trunk (scroll to explore).
  const initView = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const availW = el.clientWidth - 24;
    if (availW <= 0) return;
    const z = clampZoom(0.65);
    setZoom(z);
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollLeft = Math.max(0, centerX * z - node.clientWidth / 2);
      node.scrollTop = 0;
    });
  }, [width, centerX]);

  // Set the readable default once on mount (users can Fit / zoom from there).
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    initView();
  }, [initView]);

  const q = query.trim().toLowerCase();
  const matches = (n: MarketingTreeNode) =>
    !q ||
    `${n.label} ${n.summary ?? ""} ${n.owner_name ?? ""}`.toLowerCase().includes(q);

  // The connector paths to highlight for the hovered node: its own + parent's.
  const highlightPaths = useMemo(() => {
    const set = new Set<string>();
    if (!hoverId) return set;
    let cur = byId.get(hoverId)?.node;
    let guard = 0;
    while (cur && guard++ < 6) {
      set.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id)?.node : undefined;
    }
    return set;
  }, [hoverId, byId]);

  function nodeOpacity(n: MarketingTreeNode): number {
    if (focusZone && n.zone !== focusZone) return 0.18;
    if (!matches(n)) return 0.2;
    return 1;
  }

  const attentionCount = visibleNodes.filter(
    (n) => n.status === "needs_attention",
  ).length;

  // Whole-department freshness: bucket every node by how long since it was last
  // handled, then roll up into a 0–100 health score for an at-a-glance read.
  const health = useMemo(() => {
    const buckets = [0, 0, 0, 0];
    for (const n of visibleNodes) buckets[seasonBucket(n.last_handled_at)]++;
    const total = visibleNodes.length;
    const score = total
      ? Math.round(
          (buckets[0] * 100 + buckets[1] * 66 + buckets[2] * 33) / total,
        )
      : 0;
    return { buckets, total, score };
  }, [visibleNodes]);

  // A branch reflects its sub-categories: it takes the WORST (highest) freshness
  // bucket among its child leaves, so a branch only turns green once every leaf
  // beneath it is green. Branches with no children fall back to their own age.
  const branchBucket = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of visibleNodes) {
      if (b.zone !== "branch") continue;
      const kids = visibleNodes.filter((n) => n.parent_id === b.id);
      m.set(
        b.id,
        kids.length
          ? Math.max(...kids.map((k) => seasonBucket(k.last_handled_at)))
          : seasonBucket(b.last_handled_at),
      );
    }
    return m;
  }, [visibleNodes]);

  return (
    <section className="space-y-3">
      <style>{`
        @keyframes gdo-pulse { 0%,100% { opacity: .35 } 50% { opacity: .9 } }
        .gdo-attn-ring { animation: gdo-pulse 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gdo-attn-ring { animation: none; opacity: .8 } }
      `}</style>

      {/* Department health — seasonal freshness roll-up + colour legend */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-40">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Department health
            </p>
            <p className="text-lg font-bold text-slate-800">
              {health.score}%{" "}
              <span className="text-sm font-medium text-slate-500">
                {healthLabel(health.score)}
              </span>
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-12 font-semibold text-slate-400">Leaves</span>
              {SEASON_LEAF.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: s.fill }}
                  />
                  {SEASON_LABELS[i]}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-12 font-semibold text-slate-400">Roots</span>
              {SEASON_ROOT.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: s.fill }}
                  />
                  {SEASON_LABELS[i]}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          {health.buckets.map((count, b) =>
            count > 0 ? (
              <div
                key={b}
                style={{
                  width: `${(count / Math.max(health.total, 1)) * 100}%`,
                  background: SEASON_LEAF[b].fill,
                }}
                title={`${SEASON_LABELS[b]}: ${count}`}
              />
            ) : null,
          )}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>Fresh {health.buckets[0]}</span>
          <span>Aging {health.buckets[1]}</span>
          <span>Stale {health.buckets[2]}</span>
          <span>Overdue {health.buckets[3]}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className={`${fieldInput} w-56`}
        />
        <div className="flex flex-wrap gap-1">
          {TREE_ZONES.map((z) => (
            <button
              key={z.value}
              type="button"
              onClick={() => setFocusZone(focusZone === z.value ? null : z.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                focusZone === z.value
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={z.hint}
            >
              {z.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Show archived
        </label>
        {attentionCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {attentionCount} need attention
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            className={`${btnPrimary} ml-auto`}
            onClick={() => setEditing({ zone: "canopy" })}
          >
            + Node
          </button>
        )}
      </div>

      {/* Zoom controls */}
      <div className="hidden items-center gap-1.5 md:flex">
        <span className="text-xs font-medium text-slate-500">Zoom</span>
        <button
          type="button"
          className={`${btnGhost} px-2.5 py-1.5`}
          onClick={() => setZoom((z) => clampZoom(z - 0.1))}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-slate-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className={`${btnGhost} px-2.5 py-1.5`}
          onClick={() => setZoom((z) => clampZoom(z + 0.1))}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className={`${btnGhost} px-2.5 py-1.5`}
          onClick={fitZoom}
          title="Fit whole tree in view"
        >
          Fit
        </button>
        <button
          type="button"
          className={`${btnGhost} px-2.5 py-1.5`}
          onClick={() => setZoom(1)}
          title="Reset to 100%"
        >
          100%
        </button>
      </div>

      {/* --- SVG tree (desktop / tablet) — native size; scroll to explore --- */}
      <div
        ref={scrollRef}
        className="hidden overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block"
        style={{ maxHeight: "78vh" }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width * zoom}
          height={height * zoom}
          style={{ display: "block", maxWidth: "none" }}
          role="img"
          aria-label="Marketing tree"
          onClick={() => setFocusZone(null)}
        >
          {/* Sky / soil background */}
          <rect x={0} y={0} width={width} height={GROUND_Y} fill={SKY} />
          <rect x={0} y={GROUND_Y} width={width} height={height - GROUND_Y} fill={SOIL} />
          <rect x={0} y={GROUND_Y + (height - GROUND_Y) * 0.55} width={width} height={(height - GROUND_Y) * 0.45} fill={SOIL_DEEP} opacity={0.5} />

          {/* Trunk */}
          <rect
            x={centerX - TRUNK_HALF}
            y={TRUNK_TOP_Y}
            width={TRUNK_HALF * 2}
            height={GROUND_Y - TRUNK_TOP_Y + 6}
            fill={BARK}
            rx={10}
          />

          {/* Connector paths (branches + roots + twigs) */}
          {positioned.map((p) =>
            p.pathD ? (
              <path
                key={`path-${p.node.id}`}
                d={p.pathD}
                fill="none"
                stroke={
                  p.node.zone === "branch" || p.node.zone === "root_primary"
                    ? BARK
                    : p.node.zone === "canopy"
                      ? "#4E8B54"
                      : "#8A6A4A"
                }
                strokeWidth={
                  p.node.zone === "branch" || p.node.zone === "root_primary" ? 10 : 3.5
                }
                strokeLinecap="round"
                opacity={
                  (highlightPaths.has(p.node.id) ? 1 : 0.5) *
                  (focusZone && p.node.zone !== focusZone ? 0.35 : 1)
                }
              />
            ) : null,
          )}

          {/* Ground line */}
          <g>
            <line x1={0} y1={GROUND_Y} x2={width} y2={GROUND_Y} stroke="#C9B79A" strokeWidth={4} />
            <rect x={0} y={GROUND_Y - 3} width={width} height={6} fill="#C9B79A" opacity={0.5} />
            <rect x={centerX - 20} y={GROUND_Y - 22} width={40} height={30} rx={4} fill="#EFE7D5" stroke={BARK} strokeWidth={1.5} />
            <circle cx={centerX + 9} cy={GROUND_Y - 7} r={2} fill={BARK} />
            <text x={16} y={GROUND_Y - 10} fontSize={13} fontWeight={700} fill="#7A6A52">
              FIRST VISIT
            </text>
            <text x={16} y={GROUND_Y + 20} fontSize={11} fill="#B7A98E">
              ↑ Outside — attract &nbsp;·&nbsp; ↓ Inside — retain
            </text>
          </g>

          {/* Zone labels */}
          <ZoneLabel x={30} y={70} label="Categories" sub="lists of the real things" color="#2f5d34" onClick={() => setFocusZone(focusZone === "canopy" ? null : "canopy")} />
          <ZoneLabel x={30} y={356} label="Attract pillars" sub="Events · Campaigns · Social · Partnerships" color="#2f5d34" onClick={() => setFocusZone(focusZone === "branch" ? null : "branch")} />
          <ZoneLabel x={centerX + TRUNK_HALF + 14} y={TRUNK_TOP_Y + 16} label="Trunk" sub="brand core" color="#5b4632" onClick={() => setFocusZone(focusZone === "trunk" ? null : "trunk")} />
          <ZoneLabel x={30} y={GROUND_Y + 70} label="Retain pillars" sub="Programs · Materials · Team & Ops" color="#d8cdb2" onClick={() => setFocusZone(focusZone === "root_primary" ? null : "root_primary")} />
          <ZoneLabel x={30} y={H - 60} label="Categories" sub="lists of the real things" color="#d8cdb2" onClick={() => setFocusZone(focusZone === "root_fine" ? null : "root_fine")} />

          {/* Nodes */}
          {positioned.map((p) => (
            <TreeNodeShape
              key={p.node.id}
              p={p}
              opacity={nodeOpacity(p.node)}
              hovered={hoverId === p.node.id}
              bucketOverride={branchBucket.get(p.node.id)}
              onHover={setHoverId}
              onSelect={setSelected}
            />
          ))}
        </svg>
      </div>

      {/* --- Accordion fallback (mobile) --- */}
      <div className="space-y-3 md:hidden">
        {TREE_ZONES.map((z) => {
          const zoneNodes = visibleNodes
            .filter((n) => n.zone === z.value && matches(n))
            .sort((a, b) => a.sort_order - b.sort_order);
          if (zoneNodes.length === 0) return null;
          return (
            <div key={z.value} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">
                  {z.label}{" "}
                  <span className="text-xs font-normal text-slate-400">{z.hint}</span>
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing({ zone: z.value })}
                    className="text-xs font-medium text-emerald-700"
                  >
                    + Add
                  </button>
                )}
              </div>
              <ul className="divide-y divide-slate-100">
                {zoneNodes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(n)}
                      className="flex w-full items-center gap-2 py-2 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: STATUS_FILL[n.status] ?? "#94a3b8" }}
                      />
                      <span className="flex-1 text-sm text-slate-700">{n.label}</span>
                      <span className="text-xs text-slate-400">{n.owner_name ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          node={selected}
          parent={selected.parent_id ? nodes.find((n) => n.id === selected.parent_id) ?? null : null}
          childNodes={nodes.filter((n) => n.parent_id === selected.id && n.status !== "archived")}
          people={people}
          linkedGoals={goals.filter((g) => g.node_id === selected.id)}
          linkedInitiatives={initiatives.filter((i) => i.node_id === selected.id)}
          upcomingEvents={upcomingEventsForNode(selected, events)}
          canEdit={canEdit}
          onOpenNode={(n) => setSelected(n)}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onHandled={() => run(() => markNodeHandled(selected.id, selected.label))}
          onArchive={() =>
            run(() => setTreeNodeStatus(selected.id, "archived"), () => setSelected(null))
          }
        />
      )}

      {/* Add / edit node dialog */}
      {editing && (
        <NodeDialog
          node={"id" in editing ? editing : null}
          presetZone={"zone" in editing && !("id" in editing) ? editing.zone : undefined}
          allNodes={nodes}
          people={people}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </section>
  );
}

function ZoneLabel({
  x,
  y,
  label,
  sub,
  color,
  onClick,
}: {
  x: number;
  y: number;
  label: string;
  sub: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ cursor: "pointer" }}
    >
      <text x={x} y={y} fontSize={16} fontWeight={800} fill={color} letterSpacing={0.5}>
        {label}
      </text>
      <text x={x} y={y + 16} fontSize={11} fill={color} opacity={0.7}>
        {sub}
      </text>
    </g>
  );
}

function TreeNodeShape({
  p,
  opacity,
  hovered,
  bucketOverride,
  onHover,
  onSelect,
}: {
  p: Positioned;
  opacity: number;
  hovered: boolean;
  bucketOverride?: number;
  onHover: (id: string | null) => void;
  onSelect: (n: MarketingTreeNode) => void;
}) {
  const { node, x, y, w, h, lines } = p;
  const style = ZONE_STYLE[node.zone] ?? ZONE_STYLE.canopy;
  const attn = node.status === "needs_attention";
  const itemCount = node.items?.length ?? 0;
  // Seasonal freshness: leaves and roots are tinted by how long since the node
  // was last handled so neglected areas stand out. Branches inherit the worst
  // freshness of their child leaves (via bucketOverride) so they only green up
  // once everything beneath them is fresh. Other structural zones (trunk) keep
  // their fixed bark styling.
  const season = seasonStyle(node.zone, node.last_handled_at);
  const overrideStyle =
    !season && bucketOverride != null ? SEASON_LEAF[bucketOverride] : null;
  const fill = season?.fill ?? overrideStyle?.fill ?? style.fill;
  const textColor = season?.text ?? overrideStyle?.text ?? style.text;
  const overdue = (season?.bucket ?? bucketOverride) === 3;
  const firstLineY = h / 2 - ((lines.length - 1) * LINE_H) / 2 + 4;
  return (
    <g
      transform={`translate(${x - w / 2}, ${y - h / 2})`}
      opacity={opacity}
      tabIndex={0}
      role="button"
      aria-label={`${node.label} — ${nodeStatusLabel(node.status)}`}
      style={{ cursor: "pointer", outline: "none" }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node);
        }
      }}
    >
      {attn && (
        <rect
          className="gdo-attn-ring"
          x={-4}
          y={-4}
          width={w + 8}
          height={h + 8}
          rx={style.rx + 4}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={3}
        />
      )}
      <rect
        width={w}
        height={h}
        rx={style.rx}
        fill={fill}
        stroke={hovered ? "#0f766e" : overdue ? "#7f1d1d" : "rgba(0,0,0,0.15)"}
        strokeWidth={hovered ? 2.5 : overdue ? 1.5 : 1}
        strokeDasharray={overdue && !hovered ? "5 3" : undefined}
      />
      <circle cx={9} cy={9} r={3.5} fill={STATUS_FILL[node.status] ?? "#94a3b8"} />
      <text
        x={w / 2}
        textAnchor="middle"
        fontSize={NODE_FONT}
        fontWeight={600}
        fill={textColor}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={w / 2} y={firstLineY + i * LINE_H}>
            {line}
          </tspan>
        ))}
      </text>
      {itemCount > 0 && (
        <g transform={`translate(${w - 13}, 4)`} aria-hidden>
          <circle cx={0} cy={0} r={9} fill="#0f766e" />
          <text x={0} y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ffffff">
            {itemCount}
          </text>
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Detail slide-in panel
// ---------------------------------------------------------------------------
const PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-500",
};

// Dot color for an in-node list item, by its status.
const ITEM_STATUS_FILL: Record<string, string> = {
  idea: "#a855f7",
  planned: "#3b82f6",
  confirmed: "#0ea5e9",
  active: "#16a34a",
  done: "#94a3b8",
  hold: "#f59e0b",
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
}
function handledLabel(iso: string | null): string {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (isNaN(d)) return "never";
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Events that belong on a node's list: their event_type matches the node's
 *  tagged event_type and they're still upcoming (no date, or starts today or
 *  later). Sorted soonest-first — past events drop off automatically once the
 *  event date passes. */
function upcomingEventsForNode(
  node: MarketingTreeNode,
  events: MarketingEvent[],
): MarketingEvent[] {
  if (!node.event_type) return [];
  const today = new Date().toISOString().slice(0, 10);
  return events
    .filter(
      (e) =>
        e.event_type === node.event_type &&
        (e.starts_on == null || e.starts_on >= today),
    )
    .sort((a, b) => (a.starts_on ?? "9999").localeCompare(b.starts_on ?? "9999"));
}

function DetailPanel({
  node,
  parent,
  childNodes,
  people,
  linkedGoals,
  linkedInitiatives,
  upcomingEvents,
  canEdit,
  onOpenNode,
  onClose,
  onEdit,
  onHandled,
  onArchive,
}: {
  node: MarketingTreeNode;
  parent: MarketingTreeNode | null;
  childNodes: MarketingTreeNode[];
  people: PersonOption[];
  linkedGoals: MarketingGoal[];
  linkedInitiatives: MarketingInitiative[];
  upcomingEvents: MarketingEvent[];
  canEdit: boolean;
  onOpenNode: (n: MarketingTreeNode) => void;
  onClose: () => void;
  onEdit: () => void;
  onHandled: () => void;
  onArchive: () => void;
}) {
  const owner = node.owner_person_id
    ? people.find((p) => p.id === node.owner_person_id)
    : null;
  const ownerName = owner ? personLabel(owner) : node.owner_name;
  const hasBudget =
    node.budget_amount != null || node.budget_spent != null || !!node.budget_notes;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 bg-slate-900/30 backdrop-blur-sm" />
      <aside className="flex w-full max-w-[400px] flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
              {treeZoneLabel(node.zone)}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-slate-900">{node.label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Last handled + Updated button */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
          <div className="text-xs text-slate-500">
            Last handled{" "}
            <span className="font-semibold text-slate-700">{handledLabel(node.last_handled_at)}</span>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onHandled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              ✓ Updated
            </button>
          )}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                background: `${STATUS_FILL[node.status] ?? "#94a3b8"}22`,
                color: STATUS_FILL[node.status] ?? "#475569",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_FILL[node.status] ?? "#94a3b8" }} />
              {nodeStatusLabel(node.status)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_TONE[node.priority] ?? ""}`}>
              {priorityLabel(node.priority)} priority
            </span>
            {ownerName && (
              owner ? (
                <Link href="/hr" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200">
                  👤 {ownerName} ↗
                </Link>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  👤 {ownerName}
                </span>
              )
            )}
            {node.due_date && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                📅 {node.due_date}
              </span>
            )}
          </div>

          {parent && (
            <button
              type="button"
              onClick={() => onOpenNode(parent)}
              className="text-left text-xs text-slate-400 hover:text-emerald-700"
            >
              ↑ Grows from <span className="font-medium text-slate-600">{parent.label}</span>
            </button>
          )}

          {node.summary && <p className="text-sm leading-relaxed text-slate-600">{node.summary}</p>}

          {node.items && node.items.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                In this node ({node.items.length})
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {node.items.map((it, i) => {
                  const dot = ITEM_STATUS_FILL[it.status ?? ""] ?? "#94a3b8";
                  const internal = !!it.url && it.url.startsWith("/");
                  const dest = it.url ? destinationForUrl(it.url) : undefined;
                  const body = (
                    <>
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: dot }}
                        title={itemStatusLabel(it.status)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug text-slate-700">
                          {it.label}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                          <span className="font-medium text-slate-500">{itemStatusLabel(it.status)}</span>
                          {it.date && <span>· 📅 {it.date}</span>}
                          {it.owner && <span>· 👤 {it.owner}</span>}
                        </span>
                      </span>
                      {it.url && (
                        <span className="mt-0.5 shrink-0 text-emerald-500">
                          {dest?.icon ? <span aria-hidden>{dest.icon}</span> : internal ? "→" : "↗"}
                        </span>
                      )}
                    </>
                  );
                  const cls =
                    "flex items-start gap-2.5 px-3 py-2 text-left transition hover:bg-emerald-50/60";
                  if (!it.url) {
                    return (
                      <li key={i} className={cls.replace(" hover:bg-emerald-50/60", "")}>
                        {body}
                      </li>
                    );
                  }
                  return (
                    <li key={i}>
                      {internal ? (
                        <Link href={it.url} className={cls}>
                          {body}
                        </Link>
                      ) : (
                        <a href={it.url} target="_blank" rel="noopener noreferrer" className={cls}>
                          {body}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {upcomingEvents.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Upcoming events ({upcomingEvents.length})
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {upcomingEvents.map((e) => (
                  <li key={`ev-${e.id}`} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="mt-0.5 shrink-0 text-sky-400" aria-hidden>📅</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-slate-700">{e.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                        <span className="font-medium text-slate-500">{eventTypeLabel(e.event_type)}</span>
                        {e.starts_on && <span>· 📅 {e.starts_on}</span>}
                        {e.location && <span>· 📍 {e.location}</span>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(linkedInitiatives.length > 0 || linkedGoals.length > 0) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Goals &amp; initiatives ({linkedInitiatives.length + linkedGoals.length})
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {linkedGoals.map((g) => {
                  const pct =
                    g.target_value && g.target_value > 0
                      ? Math.min(100, Math.round(((g.current_value ?? 0) / g.target_value) * 100))
                      : null;
                  return (
                    <li key={`g-${g.id}`} className="flex items-start gap-2.5 px-3 py-2">
                      <span className="mt-0.5 shrink-0 text-amber-400" aria-hidden>🎯</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug text-slate-700">{g.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                          <span className="font-medium text-slate-500">Goal</span>
                          {pct != null && <span>· {pct}%</span>}
                          {g.period && <span>· {g.period}</span>}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {linkedInitiatives.map((i) => (
                  <li key={`i-${i.id}`} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="mt-0.5 shrink-0 text-emerald-400" aria-hidden>⭐</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-slate-700">{i.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                        <span className="font-medium text-slate-500">{initiativeStatusLabel(i.status)}</span>
                        {i.due_date && <span>· 📅 {i.due_date}</span>}
                        {i.owner_name && <span>· 👤 {i.owner_name}</span>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {childNodes.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Sub-nodes ({childNodes.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {childNodes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenNode(c)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_FILL[c.status] ?? "#94a3b8" }} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasBudget && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Budget</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-sm font-bold text-slate-900">{fmtMoney(node.budget_amount)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Allocated</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{fmtMoney(node.budget_spent)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Spent</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {node.budget_amount != null ? fmtMoney((node.budget_amount ?? 0) - (node.budget_spent ?? 0)) : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Remaining</p>
                </div>
              </div>
              {node.budget_notes && <p className="mt-2 text-xs text-slate-500">{node.budget_notes}</p>}
            </div>
          )}

          {node.links && node.links.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Connected to</p>
              {node.links.map((l, i) => {
                const dest = destinationForUrl(l.url);
                const internal = l.url.startsWith("/");
                const inner = (
                  <>
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{dest?.icon ?? (internal ? "🔗" : "🌐")}</span>
                      {l.label}
                    </span>
                    <span className="text-emerald-500">{internal ? "→" : "↗"}</span>
                  </>
                );
                const cls =
                  "flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50";
                return internal ? (
                  <Link key={i} href={l.url} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className={cls}>
                    {inner}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {canEdit && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
            {node.status !== "archived" ? (
              <button type="button" onClick={onArchive} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                Archive
              </button>
            ) : (
              <span className="text-xs text-slate-400">Archived</span>
            )}
            <button type="button" onClick={onEdit} className={btnPrimary}>
              Edit node
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Add / edit node dialog
// ---------------------------------------------------------------------------
function NodeDialog({
  node,
  presetZone,
  allNodes,
  people,
  onClose,
  run,
}: {
  node: MarketingTreeNode | null;
  presetZone?: string;
  allNodes: MarketingTreeNode[];
  people: PersonOption[];
  onClose: () => void;
  run: Run;
}) {
  const [zone, setZone] = useState(node?.zone ?? presetZone ?? "canopy");
  const [links, setLinks] = useState<InitiativeLink[]>(node?.links ?? []);
  const [items, setItems] = useState<TreeItem[]>(node?.items ?? []);

  const updateItem = (idx: number, patch: Partial<TreeItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const parentOptions =
    zone === "canopy"
      ? allNodes.filter((n) => n.zone === "branch")
      : zone === "root_fine"
        ? allNodes.filter((n) => n.zone === "root_primary")
        : [];

  const sortedPeople = [...people].sort((a, b) =>
    personLabel(a).localeCompare(personLabel(b)),
  );

  const linkedUrls = links.map((l) => l.url);
  const suggestions = suggestDestinations(
    `${node?.label ?? ""} ${zone} ${node?.summary ?? ""}`,
    linkedUrls,
  );
  const addDestination = (url: string) => {
    const d = APP_DESTINATIONS.find((x) => x.url === url);
    if (!d || linkedUrls.includes(d.url)) return;
    setLinks([...links, { label: d.label, url: d.url }]);
  };

  // CRM record search (link a node straight to a specific vendor/rescue/etc.).
  const [recordQuery, setRecordQuery] = useState("");
  const [recordHits, setRecordHits] = useState<CrmRecordHit[]>([]);
  const [recordSearching, setRecordSearching] = useState(false);
  async function runRecordSearch() {
    if (recordQuery.trim().length < 2) return;
    setRecordSearching(true);
    try {
      setRecordHits(await searchCrmRecords(recordQuery));
    } finally {
      setRecordSearching(false);
    }
  }
  const addRecord = (hit: CrmRecordHit) => {
    if (linkedUrls.includes(hit.url)) return;
    setLinks([...links, { label: hit.label, url: hit.url }]);
    setRecordHits([]);
    setRecordQuery("");
  };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveTreeNode(fd), onClose);
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">
            {node ? "Edit node" : "Plant a node"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <form onSubmit={onSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {node && <input type="hidden" name="id" value={node.id} />}
          <div>
            <label className={fieldLabel}>Label</label>
            <input name="label" defaultValue={node?.label ?? ""} required className={fieldInput} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={fieldLabel}>Zone</label>
              <select name="zone" value={zone} onChange={(e) => setZone(e.target.value)} className={fieldInput}>
                {TREE_ZONES.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel}>Status</label>
              <select name="status" defaultValue={node?.status ?? "active"} className={fieldInput}>
                {NODE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel}>Priority</label>
              <select name="priority" defaultValue={node?.priority ?? "medium"} className={fieldInput}>
                {PRIORITIES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={fieldLabel}>Owner (from HR roster)</label>
            <select name="owner_person_id" defaultValue={node?.owner_person_id ?? ""} className={fieldInput}>
              <option value="">— unassigned —</option>
              {sortedPeople.map((p) => (
                <option key={p.id} value={p.id}>{personLabel(p)}</option>
              ))}
            </select>
          </div>

          {parentOptions.length > 0 && (
            <div>
              <label className={fieldLabel}>
                Grows from ({zone === "canopy" ? "branch" : "primary root"})
              </label>
              <select name="parent_id" defaultValue={node?.parent_id ?? ""} className={fieldInput}>
                <option value="">— none —</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={fieldLabel}>Due date</label>
            <input type="date" name="due_date" defaultValue={node?.due_date ?? ""} className={fieldInput} />
          </div>

          <div>
            <label className={fieldLabel}>Event type (auto-list upcoming events)</label>
            <select name="event_type" defaultValue={node?.event_type ?? ""} className={fieldInput}>
              <option value="">— none —</option>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              When set, upcoming events of this type (from the Events tab) appear on this
              node automatically, and drop off after the event date passes.
            </p>
          </div>

          <div>
            <label className={fieldLabel}>Summary</label>
            <textarea name="summary" defaultValue={node?.summary ?? ""} rows={2} className={fieldInput} />
          </div>

          {/* In-node list — the granular items that live inside this node */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              List items (what lives in this node)
            </legend>
            <p className="mb-2 text-[11px] text-slate-400">
              The specifics — e.g. individual events, promos or tasks. Each can link to a
              Calendar / CRM / Reporting page or an external URL.
            </p>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
                  <div className="flex items-center gap-2">
                    <input
                      name="item_label"
                      value={it.label}
                      onChange={(e) => updateItem(idx, { label: e.target.value })}
                      placeholder="Item name (e.g. Adoptapalooza)"
                      className={`${fieldInput} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-400 hover:text-red-600"
                      aria-label="Remove item"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <select
                      name="item_status"
                      value={it.status ?? "planned"}
                      onChange={(e) => updateItem(idx, { status: e.target.value })}
                      className={fieldInput}
                    >
                      {ITEM_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <input
                      name="item_date"
                      value={it.date ?? ""}
                      onChange={(e) => updateItem(idx, { date: e.target.value })}
                      placeholder="Date / cadence"
                      className={fieldInput}
                    />
                    <OwnerSelect
                      name="item_owner"
                      people={people}
                      value={it.owner ?? ""}
                      onChange={(v) => updateItem(idx, { owner: v })}
                      placeholder="— owner —"
                      className={fieldInput}
                    />
                    <input
                      name="item_url"
                      value={it.url ?? ""}
                      onChange={(e) => updateItem(idx, { url: e.target.value })}
                      placeholder="/calendar or https://…"
                      className={fieldInput}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setItems([...items, { label: "", date: "", status: "planned", owner: "", url: "" }])
                }
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                + Add item
              </button>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Budget (visible to all)</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>Allocated ($)</label>
                <input name="budget_amount" defaultValue={node?.budget_amount ?? ""} className={fieldInput} />
              </div>
              <div>
                <label className={fieldLabel}>Spent ($)</label>
                <input name="budget_spent" defaultValue={node?.budget_spent ?? ""} className={fieldInput} />
              </div>
            </div>
            <div className="mt-3">
              <label className={fieldLabel}>Budget notes</label>
              <input name="budget_notes" defaultValue={node?.budget_notes ?? ""} className={fieldInput} />
            </div>
          </fieldset>

          {/* Smart connect — link this node to other pages/sources in the app */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <label className={`${fieldLabel} text-emerald-700`}>Connect to app pages</label>
            {suggestions.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] text-emerald-700/80">Suggested for this node:</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((d) => (
                    <button
                      key={d.url}
                      type="button"
                      onClick={() => addDestination(d.url)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      <span aria-hidden>{d.icon}</span> + {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addDestination(e.target.value);
              }}
              className={fieldInput}
            >
              <option value="">Add a destination…</option>
              {APP_DESTINATIONS.filter((d) => !linkedUrls.includes(d.url)).map((d) => (
                <option key={d.url} value={d.url}>
                  {d.icon} {d.label}
                </option>
              ))}
            </select>

            {/* Link a specific CRM record */}
            <div className="mt-3">
              <p className="mb-1 text-[11px] text-emerald-700/80">Or link a specific CRM record (vendor, rescue, partner, influencer):</p>
              <div className="flex gap-2">
                <input
                  value={recordQuery}
                  onChange={(e) => setRecordQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runRecordSearch();
                    }
                  }}
                  placeholder="Search e.g. Sherman Oaks Chamber…"
                  className={fieldInput}
                />
                <button
                  type="button"
                  onClick={() => void runRecordSearch()}
                  disabled={recordSearching || recordQuery.trim().length < 2}
                  className={`${btnGhost} shrink-0`}
                >
                  {recordSearching ? "…" : "Search"}
                </button>
              </div>
              {recordHits.length > 0 && (
                <ul className="mt-2 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {recordHits.map((h) => (
                    <li key={h.url}>
                      <button
                        type="button"
                        onClick={() => addRecord(h)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-emerald-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{h.label}</span>
                          {h.sub && <span className="block truncate text-xs capitalize text-slate-400">{h.sub}</span>}
                        </span>
                        <span className="shrink-0 text-emerald-600">+ Add</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <label className={fieldLabel}>Links</label>
            <div className="space-y-2">
              {links.map((l, idx) => {
                const dest = destinationForUrl(l.url);
                return (
                  <div key={idx} className="flex items-center gap-2">
                    {dest && <span className="text-base" aria-hidden>{dest.icon}</span>}
                    <input name="link_label" defaultValue={l.label} placeholder="Label" className={`${fieldInput} w-1/3`} />
                    <input name="link_url" defaultValue={l.url} placeholder="/crm/referral or https://…" className={fieldInput} />
                    <button
                      type="button"
                      onClick={() => setLinks(links.filter((_, i) => i !== idx))}
                      className="shrink-0 rounded-lg border border-slate-200 px-2 text-slate-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setLinks([...links, { label: "", url: "" }])}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                + Add custom link
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <div>
              {node && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete "${node.label}"? This cannot be undone.`))
                      run(() => deleteTreeNode(node.id), onClose);
                  }}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  Delete node
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary}>
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
