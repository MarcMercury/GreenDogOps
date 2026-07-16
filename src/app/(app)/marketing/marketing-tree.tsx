"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type MarketingTreeNode,
  type InitiativeLink,
  TREE_ZONES,
  NODE_STATUSES,
  nodeStatusLabel,
  treeZoneLabel,
} from "@/lib/marketing/types";
import {
  saveTreeNode,
  setTreeNodeStatus,
  deleteTreeNode,
  type ActionResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Canvas geometry
// ---------------------------------------------------------------------------
const W = 1200;
const H = 1200;
const GROUND_Y = 780;
const TRUNK_X = W / 2;
const TRUNK_HALF = 55;
const TRUNK_TOP_Y = 470;

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

interface Positioned {
  node: MarketingTreeNode;
  x: number;
  y: number;
  pathD: string | null; // connector from parent/anchor to this node
}

type Run = (action: () => Promise<ActionResult>, after?: () => void) => void;

// ---------------------------------------------------------------------------
// Layout — deterministic positions computed from the hierarchy + zone.
// ---------------------------------------------------------------------------
function computeLayout(nodes: MarketingTreeNode[]): {
  positioned: Positioned[];
  byId: Map<string, Positioned>;
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

  // Branches: fan out into the sky from the trunk top.
  const branchAnchor = { x: TRUNK_X, y: TRUNK_TOP_Y };
  branches.forEach((b, i) => {
    const t = branches.length > 1 ? i / (branches.length - 1) : 0.5;
    const x = 150 + t * (W - 300);
    const y = 200 + Math.abs(t - 0.5) * 2 * 180; // outer branches lower
    const midY = (branchAnchor.y + y) / 2;
    const pathD = `M ${branchAnchor.x} ${branchAnchor.y} C ${branchAnchor.x} ${midY}, ${x} ${midY + 30}, ${x} ${y}`;
    push({ node: b, x, y, pathD });
  });

  // Canopy: fan around the parent branch endpoint.
  for (const branch of branches) {
    const parentPos = byId.get(branch.id);
    if (!parentPos) continue;
    const kids = nodes
      .filter((n) => n.zone === "canopy" && n.parent_id === branch.id)
      .sort(bySort);
    kids.forEach((k, j) => {
      const n = kids.length;
      const u = n > 1 ? j / (n - 1) : 0.5;
      const ang = (-176 + u * 172) * (Math.PI / 180); // wide upward fan
      const tiers = n > 6 ? 4 : 3;
      const r = 124 + (j % tiers) * 54; // multi-tier stagger clears the branch
      const x = clamp(parentPos.x + r * Math.cos(ang), 90, W - 90);
      const y = clamp(parentPos.y + r * Math.sin(ang), 44, GROUND_Y - 44);
      const pathD = `M ${parentPos.x} ${parentPos.y} Q ${(parentPos.x + x) / 2} ${(parentPos.y + y) / 2 - 10}, ${x} ${y}`;
      push({ node: k, x, y, pathD });
    });
  }
  // Orphan canopy (no valid branch parent): line them up near the top.
  const orphanCanopy = nodes.filter(
    (n) => n.zone === "canopy" && !byId.has(n.id),
  );
  orphanCanopy.forEach((n, i) => {
    push({ node: n, x: 120 + i * 150, y: 90, pathD: null });
  });

  // Trunk plaques: stacked down the trunk.
  const topY = TRUNK_TOP_Y + 40;
  const botY = GROUND_Y - 26;
  trunks.forEach((n, k) => {
    const step = (botY - topY) / trunks.length;
    const y = topY + k * step + step / 2;
    push({ node: n, x: TRUNK_X, y, pathD: null });
  });

  // Primary roots: fan downward into the soil from the trunk base.
  const rootAnchor = { x: TRUNK_X, y: GROUND_Y };
  proots.forEach((n, i) => {
    const t = proots.length > 1 ? i / (proots.length - 1) : 0.5;
    const x = 190 + t * (W - 380);
    const y = 900 + Math.abs(t - 0.5) * 2 * 130; // outer roots deeper
    const midY = (rootAnchor.y + y) / 2;
    const pathD = `M ${rootAnchor.x} ${rootAnchor.y} C ${rootAnchor.x} ${midY}, ${x} ${midY - 20}, ${x} ${y}`;
    push({ node: n, x, y, pathD });
  });

  // Fine roots: fan below the parent primary root.
  for (const proot of proots) {
    const parentPos = byId.get(proot.id);
    if (!parentPos) continue;
    const kids = nodes
      .filter((n) => n.zone === "root_fine" && n.parent_id === proot.id)
      .sort(bySort);
    kids.forEach((k, j) => {
      const n = kids.length;
      const u = n > 1 ? j / (n - 1) : 0.5;
      const ang = (28 + u * 124) * (Math.PI / 180); // downward fan
      const tiers = n > 6 ? 4 : 3;
      const r = 118 + (j % tiers) * 50; // multi-tier stagger
      const x = clamp(parentPos.x + r * Math.cos(ang), 90, W - 90);
      const y = clamp(parentPos.y + r * Math.sin(ang), GROUND_Y + 30, H - 40);
      const pathD = `M ${parentPos.x} ${parentPos.y} Q ${(parentPos.x + x) / 2} ${(parentPos.y + y) / 2 + 10}, ${x} ${y}`;
      push({ node: k, x, y, pathD });
    });
  }
  const orphanFine = nodes.filter(
    (n) => n.zone === "root_fine" && !byId.has(n.id),
  );
  orphanFine.forEach((n, i) => {
    push({ node: n, x: 150 + i * 150, y: H - 60, pathD: null });
  });

  return { positioned, byId };
}

// ===========================================================================
// Marketing Tree
// ===========================================================================
export function MarketingTree({
  canEdit,
  nodes,
}: {
  canEdit: boolean;
  nodes: MarketingTreeNode[];
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

  const { positioned, byId } = useMemo(
    () => computeLayout(visibleNodes),
    [visibleNodes],
  );

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

      {/* --- SVG tree (desktop / tablet) --- */}
      <div className="hidden overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          style={{ minWidth: 900 }}
          role="img"
          aria-label="Marketing tree"
          onClick={() => setFocusZone(null)}
        >
          {/* Sky / soil background */}
          <rect x={0} y={0} width={W} height={GROUND_Y} fill={SKY} />
          <rect x={0} y={GROUND_Y} width={W} height={H - GROUND_Y} fill={SOIL} />
          <rect x={0} y={GROUND_Y + (H - GROUND_Y) * 0.55} width={W} height={(H - GROUND_Y) * 0.45} fill={SOIL_DEEP} opacity={0.5} />

          {/* Trunk */}
          <rect
            x={TRUNK_X - TRUNK_HALF}
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
                  p.node.zone === "branch" || p.node.zone === "root_primary" ? 12 : 4
                }
                strokeLinecap="round"
                opacity={
                  (highlightPaths.has(p.node.id) ? 1 : 0.55) *
                  (focusZone && p.node.zone !== focusZone ? 0.35 : 1)
                }
              />
            ) : null,
          )}

          {/* Ground line */}
          <g>
            <line x1={0} y1={GROUND_Y} x2={W} y2={GROUND_Y} stroke="#C9B79A" strokeWidth={4} />
            <rect x={0} y={GROUND_Y - 3} width={W} height={6} fill="#C9B79A" opacity={0.5} />
            <rect x={TRUNK_X - 20} y={GROUND_Y - 22} width={40} height={30} rx={4} fill="#EFE7D5" stroke={BARK} strokeWidth={1.5} />
            <circle cx={TRUNK_X + 9} cy={GROUND_Y - 7} r={2} fill={BARK} />
            <text x={16} y={GROUND_Y - 10} fontSize={13} fontWeight={700} fill="#7A6A52">
              FIRST VISIT
            </text>
            <text x={16} y={GROUND_Y + 20} fontSize={11} fill="#B7A98E">
              ↑ Outside — attract &nbsp;·&nbsp; ↓ Inside — retain
            </text>
          </g>

          {/* Zone labels */}
          <ZoneLabel x={30} y={70} label="Canopy" sub="one-off draws" color="#2f5d34" onClick={() => setFocusZone(focusZone === "canopy" ? null : "canopy")} />
          <ZoneLabel x={30} y={430} label="Branches" sub="core channels" color="#2f5d34" onClick={() => setFocusZone(focusZone === "branch" ? null : "branch")} />
          <ZoneLabel x={TRUNK_X + TRUNK_HALF + 14} y={TRUNK_TOP_Y + 16} label="Trunk" sub="daily essentials" color="#5b4632" onClick={() => setFocusZone(focusZone === "trunk" ? null : "trunk")} />
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
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
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
  const { node, x, y } = p;
  const style = ZONE_STYLE[node.zone] ?? ZONE_STYLE.canopy;
  const maxChars = Math.floor(style.w / 7.2);
  const attn = node.status === "needs_attention";
  return (
    <g
      transform={`translate(${x - style.w / 2}, ${y - style.h / 2})`}
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
          width={style.w + 8}
          height={style.h + 8}
          rx={style.rx + 4}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={3}
        />
      )}
      <rect
        width={style.w}
        height={style.h}
        rx={style.rx}
        fill={style.fill}
        stroke={hovered ? "#0f766e" : "rgba(0,0,0,0.12)"}
        strokeWidth={hovered ? 2.5 : 1}
      />
      <circle cx={12} cy={style.h / 2} r={4} fill={STATUS_FILL[node.status] ?? "#94a3b8"} />
      <text
        x={style.w / 2 + 6}
        y={style.h / 2 + 4}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={style.text}
      >
        {truncate(node.label, maxChars)}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Detail slide-in panel
// ---------------------------------------------------------------------------
function DetailPanel({
  node,
  parent,
  canEdit,
  onClose,
  onEdit,
  onArchive,
}: {
  node: MarketingTreeNode;
  parent: MarketingTreeNode | null;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const metricEntries = Object.entries(node.metrics ?? {});
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 bg-slate-900/30 backdrop-blur-sm" />
      <aside className="flex w-full max-w-[380px] flex-col overflow-y-auto bg-white shadow-2xl">
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
            {node.owner_name && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                👤 {node.owner_name}
              </span>
            )}
            {node.due_date && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                📅 {node.due_date}
              </span>
            )}
          </div>

          {parent && (
            <p className="text-xs text-slate-400">
              Grows from <span className="font-medium text-slate-600">{parent.label}</span>
            </p>
          )}

          {node.summary && <p className="text-sm leading-relaxed text-slate-600">{node.summary}</p>}

          {metricEntries.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {metricEntries.map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-2.5">
                  <p className="text-sm font-bold text-slate-900">{String(v)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{k}</p>
                </div>
              ))}
            </div>
          )}

          {node.links && node.links.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Go to</p>
              {node.links.map((l, i) =>
                l.url.startsWith("/") ? (
                  <Link
                    key={i}
                    href={l.url}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    {l.label} <span className="text-emerald-500">→</span>
                  </Link>
                ) : (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    {l.label} <span className="text-emerald-500">↗</span>
                  </a>
                ),
              )}
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
  onClose,
  run,
}: {
  node: MarketingTreeNode | null;
  presetZone?: string;
  allNodes: MarketingTreeNode[];
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

  const metricsText = node
    ? Object.entries(node.metrics ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

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
              <label className={fieldLabel}>Owner</label>
              <input name="owner_name" defaultValue={node?.owner_name ?? ""} className={fieldInput} />
            </div>
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

          <div>
            <label className={fieldLabel}>Metrics (one per line, e.g. newClients: 14)</label>
            <textarea name="metrics" defaultValue={metricsText} rows={2} className={fieldInput} placeholder="newClients: 14&#10;spend: 850" />
          </div>

          <div>
            <label className={fieldLabel}>Links</label>
            <div className="space-y-2">
              {links.map((l, idx) => (
                <div key={idx} className="flex gap-2">
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
              ))}
              <button
                type="button"
                onClick={() => setLinks([...links, { label: "", url: "" }])}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                + Add link
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
