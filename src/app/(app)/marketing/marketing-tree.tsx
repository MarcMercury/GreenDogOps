"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type MarketingTreeNode,
  type InitiativeLink,
  type PersonOption,
  TREE_ZONES,
  NODE_STATUSES,
  PRIORITIES,
  APP_DESTINATIONS,
  destinationForUrl,
  suggestDestinations,
  nodeStatusLabel,
  treeZoneLabel,
  priorityLabel,
  personLabel,
} from "@/lib/marketing/types";
import {
  saveTreeNode,
  setTreeNodeStatus,
  deleteTreeNode,
  markNodeHandled,
  type ActionResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Canvas geometry — vertical bands are fixed; the canvas WIDTH grows with the
// number of leaves so nothing overlaps (the SVG scrolls horizontally).
// ---------------------------------------------------------------------------
const H = 1360;
const GROUND_Y = 820;
const TRUNK_HALF = 46;
const TRUNK_TOP_Y = 500;
// Horizontal step between adjacent leaf columns. Nodes alternate between two
// rows per band, so two nodes in the SAME row are 2×COL apart. Pills wrap their
// label onto up to two lines, so they stay narrow and columns pack tightly.
const COL = 88;
const MARGIN = 52;
// Two staggered y-rows per band (nodes alternate by column parity).
const CANOPY_ROWS = [150, 262];
const BRANCH_ROWS = [372, 452];
const PRIMARY_ROWS = [936, 1016];
const FINE_ROWS = [1150, 1262];

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

/** Staleness of a node from its last-handled timestamp (module-level: pure use of Date.now). */
function staleInfo(iso: string | null): { stale: boolean; veryStale: boolean } {
  const d = iso
    ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    : null;
  return { stale: d == null || d > 30, veryStale: d == null || d > 60 };
}

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
    col += 1; // gap between branch groups
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
    rcol += 1;
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
    const y = BRANCH_ROWS[bi % 2];
    const midY = (TRUNK_TOP_Y + y) / 2;
    const pathD = `M ${centerX} ${TRUNK_TOP_Y} C ${centerX} ${midY}, ${x} ${midY}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(b.label);
    push({ node: b, x, y, w, h, lines, pathD });
  });

  // --- Canopy leaves ---
  for (const k of nodes.filter((n) => n.zone === "canopy" && canopyCol.has(n.id))) {
    const c = canopyCol.get(k.id)!;
    const x = cX(c);
    const y = CANOPY_ROWS[c % 2];
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
    const y = PRIMARY_ROWS[pi % 2];
    const midY = (GROUND_Y + y) / 2;
    const pathD = `M ${centerX} ${GROUND_Y} C ${centerX} ${midY}, ${x} ${midY}, ${x} ${y}`;
    const { lines, w, h } = layoutLabel(p.label);
    push({ node: p, x, y, w, h, lines, pathD });
  });

  // --- Fine roots ---
  for (const k of nodes.filter((n) => n.zone === "root_fine" && fineCol.has(n.id))) {
    const c = fineCol.get(k.id)!;
    const x = rX(c);
    const y = FINE_ROWS[c % 2];
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
}: {
  canEdit: boolean;
  nodes: MarketingTreeNode[];
  people: PersonOption[];
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

  // Fit the whole tree into view on first render and whenever the canvas size
  // changes (e.g. nodes added/removed).
  useLayoutEffect(() => {
    fitZoom();
  }, [fitZoom]);

  useEffect(() => {
    const onResize = () => fitZoom();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitZoom]);

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

  return (
    <section className="space-y-3">
      <style>{`
        @keyframes gdo-pulse { 0%,100% { opacity: .35 } 50% { opacity: .9 } }
        .gdo-attn-ring { animation: gdo-pulse 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gdo-attn-ring { animation: none; opacity: .8 } }
      `}</style>

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
          <ZoneLabel x={30} y={70} label="Canopy" sub="one-off draws" color="#2f5d34" onClick={() => setFocusZone(focusZone === "canopy" ? null : "canopy")} />
          <ZoneLabel x={30} y={356} label="Branches" sub="core channels" color="#2f5d34" onClick={() => setFocusZone(focusZone === "branch" ? null : "branch")} />
          <ZoneLabel x={centerX + TRUNK_HALF + 14} y={TRUNK_TOP_Y + 16} label="Trunk" sub="daily essentials" color="#5b4632" onClick={() => setFocusZone(focusZone === "trunk" ? null : "trunk")} />
          <ZoneLabel x={30} y={GROUND_Y + 70} label="Primary roots" sub="retention programs" color="#d8cdb2" onClick={() => setFocusZone(focusZone === "root_primary" ? null : "root_primary")} />
          <ZoneLabel x={30} y={H - 60} label="Fine roots" sub="individual tactics" color="#d8cdb2" onClick={() => setFocusZone(focusZone === "root_fine" ? null : "root_fine")} />

          {/* Nodes */}
          {positioned.map((p) => (
            <TreeNodeShape
              key={p.node.id}
              p={p}
              opacity={nodeOpacity(p.node)}
              hovered={hoverId === p.node.id}
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
  onHover,
  onSelect,
}: {
  p: Positioned;
  opacity: number;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (n: MarketingTreeNode) => void;
}) {
  const { node, x, y, w, h, lines } = p;
  const style = ZONE_STYLE[node.zone] ?? ZONE_STYLE.canopy;
  const attn = node.status === "needs_attention";
  // Staleness: how long since the node was last "handled". Drives a subtle tint
  // so nodes that haven't been touched in a while stand out as needing a check.
  const { stale, veryStale } = staleInfo(node.last_handled_at);
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
        fill={style.fill}
        fillOpacity={stale ? (veryStale ? 0.7 : 0.85) : 1}
        stroke={hovered ? "#0f766e" : stale ? "#b98900" : "rgba(0,0,0,0.12)"}
        strokeWidth={hovered ? 2.5 : stale ? 1.5 : 1}
        strokeDasharray={stale && !hovered ? "5 3" : undefined}
      />
      <circle cx={9} cy={9} r={3.5} fill={STATUS_FILL[node.status] ?? "#94a3b8"} />
      <text
        x={w / 2}
        textAnchor="middle"
        fontSize={NODE_FONT}
        fontWeight={600}
        fill={style.text}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={w / 2} y={firstLineY + i * LINE_H}>
            {line}
          </tspan>
        ))}
      </text>
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

function DetailPanel({
  node,
  parent,
  childNodes,
  people,
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
            <label className={fieldLabel}>Summary</label>
            <textarea name="summary" defaultValue={node?.summary ?? ""} rows={2} className={fieldInput} />
          </div>

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
