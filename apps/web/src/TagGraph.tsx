import { useEffect, useMemo, useState } from "react";
import type { TagSummary } from "./posts-api";
import { getGraph, type GraphEdge, type GraphNode, type GraphPeriod, type TagGraph } from "./stats-api";

// 石のつながり (docs/visualization.md §6): the co-occurrence network. A node is
// a stone, grown by its 苔片 count — §6's stand-in for a per-tag heatmap; an
// edge is moss bridging two stones that share 苔片, thicker the more they
// share. Hand-written SVG over a hand-rolled deterministic force layout: tens
// of stones need no library (§6 実装方針). Tapping a stone lands on the §8
// focus 年表 (its 内訳) — the page wires that up. Edges stay hover-informational
// for now; their 投稿一覧 landing waits for the post list's tag filter (Phase 1
// leftover), and their accessible reading already exists as §8's focus rows.

// ---------------------------------------------------------------- pure layout

export const VIEW_W = 600;
export const VIEW_H = 460;

const round2 = (v: number) => Math.round(v * 100) / 100;

// Stones grow on a FIXED scale, like the heatmap's level ladder: the same size
// means the same count in every period and every garden, and each 苔片 visibly
// feeds its stone. Area ~ count via sqrt, floored to stay findable, capped so
// one prolific stone cannot swallow the map.
const R_MIN = 7;
const R_GROW = 3.4;
const R_MAX = 30;

export const nodeRadius = (count: number) =>
  round2(Math.min(R_MAX, R_MIN + R_GROW * Math.sqrt(count)));

/** Bridges thicken on the same fixed terms: sqrt growth, capped. */
export const edgeWidth = (count: number) => round2(Math.min(6, 1 + 0.9 * Math.sqrt(count)));

export type LaidNode = { id: string; x: number; y: number; r: number };

type Body = LaidNode & { fx: number; fy: number };

/** Kept clear of the frame; the extra below a stone is its label line. */
const PAD = 10;
const LABEL_PAD = 26;
const ITERATIONS = 300;
/** Fraction of its centre distance a stone drifts inward per pass. */
const GRAVITY = 0.15;
/** Clearance bridged stones settle at — below it their spring lets go. */
const SPRING_REST = 12;
/** The golden angle, radians — phyllotaxis seeding, like seeds in a sunflower. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic force layout, Fruchterman–Reingold flavour: seed on a
 * phyllotaxis spiral in input order, then let three forces settle — repulsion
 * between all stones (measured surface to surface, so a grown stone claims its
 * area), spring attraction along bridges, and a pull to the centre that keeps
 * islands and lone stones in frame. No randomness anywhere: the same garden
 * draws the same map every time.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): LaidNode[] {
  if (nodes.length === 0) return [];
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  // Spiral seeding fills the disc evenly (a plain ring start survives the
  // forces as a ring-shaped hollow), and since input is count-descending the
  // grown stones open near the centre with the young ones on the rim.
  const seedSpread = Math.min(VIEW_W, VIEW_H) / 2 - 40;
  const bodies: Body[] = nodes.map((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    const spread = seedSpread * Math.sqrt((i + 0.5) / nodes.length);
    return {
      id: node.id,
      x: cx + spread * Math.cos(angle),
      y: cy + spread * Math.sin(angle),
      r: nodeRadius(node.count),
      fx: 0,
      fy: 0,
    };
  });
  const byId = new Map(bodies.map((b) => [b.id, b] as const));
  const springs: [Body, Body][] = [];
  for (const e of edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (a !== undefined && b !== undefined) springs.push([a, b]);
  }
  // Ideal spacing shrinks as stones multiply; capped, or a near-empty garden
  // would spread its two stones a whole frame apart.
  const k = Math.min(90, Math.sqrt((VIEW_W * VIEW_H) / bodies.length) * 0.55);
  for (let t = 0; t < ITERATIONS; t++) {
    // Linear cooling: bold early strides settle into millimetre nudges.
    const heat = 1 + 0.1 * Math.min(VIEW_W, VIEW_H) * (1 - t / ITERATIONS);
    for (const b of bodies) {
      b.fx = 0;
      b.fy = 0;
    }
    bodies.forEach((a, i) => {
      for (const b of bodies.slice(i + 1)) {
        let ux = a.x - b.x;
        let uy = a.y - b.y;
        let d = Math.hypot(ux, uy);
        if (d < 0.01) {
          // Coincident stones (cannot arise from the ring, but never divide by
          // ~0): part them along a fixed axis.
          ux = 1;
          uy = 0;
          d = 1;
        }
        const gap = Math.max(1, d - a.r - b.r);
        const push = (k * k) / gap / d;
        a.fx += ux * push;
        a.fy += uy * push;
        b.fx -= ux * push;
        b.fy -= uy * push;
      }
    });
    for (const [a, b] of springs) {
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const d = Math.max(0.01, Math.hypot(ux, uy));
      // FR attraction on the surface clearance (so several bridges cannot
      // squash their stones into each other), and uniform on purpose: the
      // count already speaks through the bridge's thickness.
      const slack = d - a.r - b.r - SPRING_REST;
      if (slack <= 0) continue;
      const pull = (slack * slack) / k / d;
      a.fx += ux * pull;
      a.fy += uy * pull;
      b.fx -= ux * pull;
      b.fy -= uy * pull;
    }
    for (const b of bodies) {
      b.fx += (cx - b.x) * GRAVITY;
      b.fy += (cy - b.y) * GRAVITY;
      const len = Math.hypot(b.fx, b.fy);
      if (len < 0.01) continue;
      const step = Math.min(len, heat);
      b.x = clamp(b.x + (b.fx / len) * step, PAD + b.r, VIEW_W - PAD - b.r);
      b.y = clamp(b.y + (b.fy / len) * step, PAD + b.r, VIEW_H - PAD - b.r - LABEL_PAD);
    }
  }
  // Centre the finished map: the forces can leave the garden leaning on one
  // wall, and a lean is layout debris, not data. The in-loop clamps guarantee
  // the bounding box fits, so a zero shift is always inside the clamp range.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of bodies) {
    minX = Math.min(minX, b.x - b.r);
    maxX = Math.max(maxX, b.x + b.r);
    minY = Math.min(minY, b.y - b.r);
    maxY = Math.max(maxY, b.y + b.r + LABEL_PAD);
  }
  const shiftX = clamp((VIEW_W - minX - maxX) / 2, PAD - minX, VIEW_W - PAD - maxX);
  const shiftY = clamp((VIEW_H - minY - maxY) / 2, PAD - minY, VIEW_H - PAD - maxY);
  return bodies.map((b) => ({ id: b.id, x: round2(b.x + shiftX), y: round2(b.y + shiftY), r: b.r }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hover text and accessible name of a stone. */
export const nodeTitle = (node: GraphNode) => `${node.name} · ${node.count} 片`;

/** Hover text of a bridge: the pair and the 苔片 they share. */
export const edgeTitle = (a: GraphNode, b: GraphNode, count: number) =>
  `${a.name} × ${b.name} · ${count} 片`;

// ----------------------------------------------------------------- the chart

// Exported for the markup test — geometry and structure are locked there, the
// same arrangement as TimelineChart (no in-sandbox browser to eyeball it).
export function TagGraphChart(props: { graph: TagGraph; onTagTap: (tag: TagSummary) => void }) {
  const { nodes, edges } = props.graph;
  const laid = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const at = new Map(laid.map((p) => [p.id, p] as const));
  const named = new Map(nodes.map((node) => [node.id, node] as const));
  return (
    <svg className="tg-chart" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      {/* Bridges are hover-informational; a screen reader reads the same
          co-occurrence facts as §8 focus rows, one stone-tap away. */}
      <g aria-hidden="true">
        {edges.map((e) => {
          const pa = at.get(e.a);
          const pb = at.get(e.b);
          const na = named.get(e.a);
          const nb = named.get(e.b);
          if (pa === undefined || pb === undefined || na === undefined || nb === undefined) {
            return null;
          }
          return (
            <line
              key={`${e.a}+${e.b}`}
              className="tg-edge"
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              strokeWidth={edgeWidth(e.count)}
            >
              <title>{edgeTitle(na, nb, e.count)}</title>
            </line>
          );
        })}
      </g>
      {nodes.map((node) => {
        const p = at.get(node.id);
        if (p === undefined) return null;
        return <Stone key={node.id} node={node} at={p} onTagTap={props.onTagTap} />;
      })}
    </svg>
  );
}

function Stone(props: { node: GraphNode; at: LaidNode; onTagTap: (tag: TagSummary) => void }) {
  const { node, at } = props;
  const tap = () => props.onTagTap({ id: node.id, name: node.name });
  return (
    // No native button exists inside SVG, so this is the one place the app
    // rebuilds one: role + tabindex + the native keyboard contract — Enter on
    // keydown, Space on keyup, keydown only swallows the scroll
    // (modern-web-guidance/accessibility §5).
    <g
      className="tg-node"
      role="button"
      tabIndex={0}
      aria-label={nodeTitle(node)}
      onClick={tap}
      onKeyDown={(e) => {
        if (e.key === "Enter") tap();
        if (e.key === " ") e.preventDefault();
      }}
      onKeyUp={(e) => {
        if (e.key === " ") tap();
      }}
    >
      <title>{nodeTitle(node)}</title>
      {/* An invisible disc keeps young stones (r → R_MIN) tappable. */}
      <circle className="tg-hit" cx={at.x} cy={at.y} r={Math.max(at.r, 16)} />
      <circle className="tg-stone" cx={at.x} cy={at.y} r={at.r} fill={node.color ?? undefined} />
      <text className="tg-label" x={at.x} y={at.y + at.r + 14} textAnchor="middle">
        {node.name}
      </text>
    </g>
  );
}

// --------------------------------------------------------------- the section

const PERIODS: { value: GraphPeriod; label: string }[] = [
  { value: "month", label: "今月" },
  { value: "year", label: "今年" },
  { value: "all", label: "全期間" },
];

/**
 * Data + view state around the chart. `refreshKey` bumps after a post so new
 * moss thickens its bridges right away, same as the 総草 and the 年表.
 */
export function TagGraphSection(props: {
  refreshKey: number;
  onTagTap: (tag: TagSummary) => void;
  onFault: (e: unknown) => void;
}) {
  // Answers are tagged with the period they answer, so a switch shows "…"
  // until its own answer lands and a stale map never draws under a fresh label.
  const [data, setData] = useState<{ period: GraphPeriod; graph: TagGraph } | null>(null);
  const [period, setPeriod] = useState<GraphPeriod>("all");

  const { refreshKey, onFault } = props;
  useEffect(() => {
    let cancelled = false;
    getGraph(period)
      .then((graph) => {
        if (!cancelled) setData({ period, graph });
      })
      .catch((e) => {
        if (!cancelled) onFault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, period, onFault]);

  const shown = data !== null && data.period === period ? data.graph : null;
  // Until the first tagged 苔片 exists there is no map — appear when grown,
  // like the 年表. Once the gardener is switching periods, though, an empty
  // period is an answer and a switch in flight keeps the frame: only the
  // untouched default (nothing loaded yet, or an empty 全期間) hides it.
  if (period === "all" && (shown === null ? data === null : shown.nodes.length === 0)) {
    return null;
  }

  return (
    <section className="tag-graph">
      <div className="tg-head">
        <h2>石のつながり</h2>
        <fieldset className="tg-period">
          <legend className="visually-hidden">期間</legend>
          {PERIODS.map((p) => (
            <label key={p.value}>
              <input
                type="radio"
                name="tg-period"
                value={p.value}
                checked={period === p.value}
                onChange={() => setPeriod(p.value)}
              />
              {p.label}
            </label>
          ))}
        </fieldset>
      </div>
      {shown === null ? (
        <p className="quiet">…</p>
      ) : shown.nodes.length === 0 ? (
        <p className="quiet">この期間に積んだ苔片はありません。</p>
      ) : (
        <TagGraphChart graph={shown} onTagTap={props.onTagTap} />
      )}
    </section>
  );
}
