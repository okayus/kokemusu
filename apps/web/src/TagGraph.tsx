import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount } from "./amount";
import type { TagSummary } from "./posts-api";
import { getGraph, type GraphEdge, type GraphNode, type GraphPeriod, type TagGraph } from "./stats-api";

// 石のつながり (docs/visualization.md §6): the co-occurrence network. A node is
// a stone, grown by the 量 of its 苔片 — §6's stand-in for a per-tag heatmap; an
// edge is moss bridging two stones that share 苔片, thicker the more 量 they
// share. 量, not count, since ADR-0007: a 続く苔片 feeds its stones by its days
// × 厚み, and 今月 / 今年 weigh only the days inside the period (the server
// sums and clips; this file draws). Hand-written SVG over a hand-rolled
// deterministic force layout: tens of stones need no library (§6 実装方針).
// The map is the 操作盤 of both views
// (features.md §3, 2026-09-07): a stone tap toggles it in or out of the
// 選んだ石, a bridge tap toggles both its ends at once, and the set is read by
// the 投稿一覧 (AND filter) and the 年表 (its axis) below — the page wires it up.
// While stones are chosen the map keeps only their reach (reachOf, 2026-09-14),
// and the stone under the pointer or the keyboard focus is a spotlight: its
// bridges come forward, what is not bridged to it steps back.

// ---------------------------------------------------------------- pure layout

export const VIEW_W = 600;
export const VIEW_H = 460;

const round2 = (v: number) => Math.round(v * 100) / 100;

// Stones grow on a FIXED scale, like the heatmap's level ladder: the same size
// means the same 量 in every period and every garden, and each 苔片 visibly
// feeds its stone. Area ~ 量 via sqrt, floored to stay findable, capped so one
// prolific stone cannot swallow the map (the cap is reached at 量 ≈ 46 — a
// 案件 of a few months; whether the ladder wants a rethink for 量 is a call to
// make on the real garden, ADR-0007).
const R_MIN = 7;
const R_GROW = 3.4;
const R_MAX = 30;

export const nodeRadius = (amount: number) =>
  round2(Math.min(R_MAX, R_MIN + R_GROW * Math.sqrt(amount)));

/** Bridges thicken on the same fixed terms: sqrt growth, capped. */
export const edgeWidth = (amount: number) => round2(Math.min(6, 1 + 0.9 * Math.sqrt(amount)));

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
  // forces as a ring-shaped hollow), and since input is 量-descending the
  // grown stones open near the centre with the young ones on the rim.
  const seedSpread = Math.min(VIEW_W, VIEW_H) / 2 - 40;
  const bodies: Body[] = nodes.map((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    const spread = seedSpread * Math.sqrt((i + 0.5) / nodes.length);
    return {
      id: node.id,
      x: cx + spread * Math.cos(angle),
      y: cy + spread * Math.sin(angle),
      r: nodeRadius(node.amount),
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
          // Coincident stones (cannot arise from the spiral, but never divide
          // by ~0): part them along a fixed axis.
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
      // 量 already speaks through the bridge's thickness.
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

/** Hover text and accessible name of a stone: 「量 N」 (ADR-0007), the count is the 年表's. */
export const nodeTitle = (node: GraphNode) => `${node.name} · 量 ${formatAmount(node.amount)}`;

/** Hover text of a bridge: the pair and the 量 they share. */
export const edgeTitle = (a: GraphNode, b: GraphNode, amount: number) =>
  `${a.name} × ${b.name} · 量 ${formatAmount(amount)}`;

// --------------------------------------------------------------- pure reach

/** The stones bridged to `id` — the ones sharing 苔片 with it on this map. */
export function bridgedTo(edges: readonly GraphEdge[], id: string): Set<string> {
  const near = new Set<string>();
  for (const e of edges) {
    if (e.a === id) near.add(e.b);
    else if (e.b === id) near.add(e.a);
  }
  return near;
}

/**
 * What the map keeps while stones are chosen (features.md §3, 2026-09-14): the
 * 選んだ石 that are on this map, plus every stone bridged to ALL of them. The
 * intersection, not the union — the 投稿一覧 narrows by AND and the 年表's 内訳
 * lists the set × the stones co-occurring with it, so a second stone must
 * narrow the map, never widen it back. A bridge is a pairwise fact, so this is
 * the closest the map gets to "co-occurs with the whole set" without asking
 * the server. No chosen stone on the map (nothing chosen, or a period they
 * have no 苔片 in) keeps everything: the ids of all `nodes`.
 */
export function reachOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  chosen: ReadonlySet<string>,
): Set<string> {
  const onMap = nodes.filter((n) => chosen.has(n.id)).map((n) => n.id);
  if (onMap.length === 0) return new Set(nodes.map((n) => n.id));
  const reach = new Set(onMap);
  const nearEach = onMap.map((id) => bridgedTo(edges, id));
  for (const n of nodes) {
    if (nearEach.every((near) => near.has(n.id))) reach.add(n.id);
  }
  return reach;
}

// ----------------------------------------------------------------- the chart

// Exported for the markup test — geometry and structure are locked there, the
// same arrangement as TimelineChart (no in-sandbox browser to eyeball it).
export function TagGraphChart(props: {
  graph: TagGraph;
  /** The 選んだ石 (features.md §3): these stones are pressed, and so is a bridge whose both ends are. */
  selected: readonly TagSummary[];
  onStoneTap: (tag: TagSummary) => void;
  onBridgeTap: (a: TagSummary, b: TagSummary) => void;
}) {
  const { nodes, edges } = props.graph;
  const laid = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const at = new Map(laid.map((p) => [p.id, p] as const));
  const named = new Map(nodes.map((node) => [node.id, node] as const));
  const chosen = new Set(props.selected.map((t) => t.id));
  // The layout is over the whole garden and only the drawing hides: a stone
  // keeps its place while it is away, so the map never reshuffles on a tap.
  const reach = reachOf(nodes, edges, chosen);
  // The spotlight: the stone under the pointer or the keyboard focus. Honoured
  // only while it is on the map and in reach — a period switch or a hide can
  // take the stone away without any pointerleave.
  const [interest, setInterest] = useState<string | null>(null);
  const spot = interest !== null && reach.has(interest) ? interest : null;
  const nearSpot = spot === null ? null : bridgedTo(edges, spot);
  const endInterest = useCallback(
    (id: string) => setInterest((current) => (current === id ? null : current)),
    [],
  );
  return (
    <svg className="tg-chart" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      {/* Bridges first so stones paint over them (and take the later tab stops). */}
      {edges.map((e) => {
        const pa = at.get(e.a);
        const pb = at.get(e.b);
        const na = named.get(e.a);
        const nb = named.get(e.b);
        if (pa === undefined || pb === undefined || na === undefined || nb === undefined) {
          return null;
        }
        // A bridge goes with either end: hidden when one is, and under the
        // spotlight only when it touches the spot.
        const hidden = !reach.has(e.a) || !reach.has(e.b);
        return (
          <Bridge
            key={`${e.a}+${e.b}`}
            a={na}
            b={nb}
            pa={pa}
            pb={pb}
            amount={e.amount}
            pressed={chosen.has(e.a) && chosen.has(e.b)}
            hidden={hidden}
            spot={spot === null || hidden ? null : e.a === spot || e.b === spot ? "near" : "far"}
            onBridgeTap={props.onBridgeTap}
          />
        );
      })}
      {nodes.map((node) => {
        const p = at.get(node.id);
        if (p === undefined) return null;
        const hidden = !reach.has(node.id);
        return (
          <Stone
            key={node.id}
            node={node}
            at={p}
            pressed={chosen.has(node.id)}
            hidden={hidden}
            far={
              nearSpot !== null && !hidden && node.id !== spot && !nearSpot.has(node.id)
            }
            onStoneTap={props.onStoneTap}
            onInterest={setInterest}
            onInterestEnd={endInterest}
          />
        );
      })}
    </svg>
  );
}

function Bridge(props: {
  a: GraphNode;
  b: GraphNode;
  pa: LaidNode;
  pb: LaidNode;
  amount: number;
  pressed: boolean;
  /** An end of it is out of the 選んだ石's reach: gone with it. */
  hidden: boolean;
  /** Under a spotlight: touching the spot (comes forward) or not (steps back). */
  spot: "near" | "far" | null;
  onBridgeTap: (a: TagSummary, b: TagSummary) => void;
}) {
  const { a, b, pa, pb } = props;
  const tap = () => props.onBridgeTap({ id: a.id, name: a.name }, { id: b.id, name: b.name });
  return (
    // The same rebuilt-button contract as Stone (no native button inside SVG).
    // A bridge is a toggle for its two stones at once (visualization.md §6):
    // aria-pressed says whether both ends are among the 選んだ石. The data
    // attributes are the CSS's: HTML's `hidden` has no effect on SVG elements.
    <g
      className="tg-bridge"
      role="button"
      tabIndex={0}
      aria-pressed={props.pressed}
      aria-label={edgeTitle(a, b, props.amount)}
      data-hidden={props.hidden || undefined}
      data-near={props.spot === "near" || undefined}
      data-far={props.spot === "far" || undefined}
      onClick={tap}
      onKeyDown={(e) => {
        if (e.key === "Enter") tap();
        if (e.key === " ") e.preventDefault();
      }}
      onKeyUp={(e) => {
        if (e.key === " ") tap();
      }}
    >
      <title>{edgeTitle(a, b, props.amount)}</title>
      {/* An invisible fat stroke keeps a hairline bridge tappable. */}
      <line className="tg-hit-line" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} strokeWidth={14} />
      <line
        className="tg-edge"
        x1={pa.x}
        y1={pa.y}
        x2={pb.x}
        y2={pb.y}
        strokeWidth={edgeWidth(props.amount)}
      />
    </g>
  );
}

function Stone(props: {
  node: GraphNode;
  at: LaidNode;
  pressed: boolean;
  /** Out of the 選んだ石's reach: not bridged to every chosen stone. */
  hidden: boolean;
  /** Outside the spotlight: neither the spot nor bridged to it. */
  far: boolean;
  onStoneTap: (tag: TagSummary) => void;
  /** The pointer or the keyboard focus arrived: this stone is the spotlight. */
  onInterest: (id: string) => void;
  /** … and left. Only this stone's own spotlight goes out with it. */
  onInterestEnd: (id: string) => void;
}) {
  const { node, at } = props;
  const tap = () => props.onStoneTap({ id: node.id, name: node.name });
  return (
    // No native button exists inside SVG, so this is the one place the app
    // rebuilds one: role + tabindex + the native keyboard contract — Enter on
    // keydown, Space on keyup, keydown only swallows the scroll
    // (modern-web-guidance/accessibility §5). A stone is a toggle button — a
    // tap chooses it, the same tap lets it go — and aria-pressed carries that;
    // the CSS reads the same attribute for the ring and the fade. Hidden and
    // far are data attributes (HTML's `hidden` has no effect on SVG elements):
    // the CSS hides with `visibility`, which takes the tab stop and the hit
    // area away too.
    <g
      className="tg-node"
      role="button"
      tabIndex={0}
      aria-pressed={props.pressed}
      aria-label={nodeTitle(node)}
      data-hidden={props.hidden || undefined}
      data-far={props.far || undefined}
      onClick={tap}
      onKeyDown={(e) => {
        if (e.key === "Enter") tap();
        if (e.key === " ") e.preventDefault();
      }}
      onKeyUp={(e) => {
        if (e.key === " ") tap();
      }}
      // A finger's "hover" is the tap itself, so touch lights no spotlight (the
      // tap chooses instead); a mouse or a pen does. The keyboard's hover is
      // focus — the visible kind only, so a click's silent focus (no ring)
      // leaves nothing behind once the pointer moves on.
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") props.onInterest(node.id);
      }}
      onPointerLeave={() => props.onInterestEnd(node.id)}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) props.onInterest(node.id);
      }}
      onBlur={() => props.onInterestEnd(node.id)}
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
 * moss thickens its bridges right away, same as the 総草 and the 年表. The map
 * is the one 操作盤 of both views (features.md §3): it stays on screen while
 * the 投稿一覧 and the 年表 take turns below it, and its taps toggle the 選んだ石
 * that both of them read — so the section holds no selection of its own.
 */
export function TagGraphSection(props: {
  refreshKey: number;
  /** The 選んだ石, drawn pressed. */
  selected: readonly TagSummary[];
  /** A stone tap: in or out of the 選んだ石 (stones.ts の toggleStone). */
  onStoneTap: (tag: TagSummary) => void;
  /** A bridge tap: both ends in or out at once (stones.ts の togglePair). */
  onBridgeTap: (a: TagSummary, b: TagSummary) => void;
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
        <TagGraphChart
          graph={shown}
          selected={props.selected}
          onStoneTap={props.onStoneTap}
          onBridgeTap={props.onBridgeTap}
        />
      )}
    </section>
  );
}
