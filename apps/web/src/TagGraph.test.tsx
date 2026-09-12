import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TagGraphChart,
  VIEW_H,
  VIEW_W,
  edgeWidth,
  layoutGraph,
  nodeRadius,
  type LaidNode,
} from "./TagGraph";
import type { GraphEdge, GraphNode, TagGraph } from "./stats-api";

// Same 流儀 as TagTimeline.test.tsx: the chart is pure output of props, so the
// structure a browser would be eyeballed for is asserted on static markup, and
// the layout on the exported pure functions — determinism above all, because a
// map that reshuffles on every visit cannot be "watched growing".

const node = (id: string, amount: number): GraphNode => ({
  id,
  name: id.toUpperCase(),
  color: null,
  amount,
});
const edge = (a: string, b: string, amount = 1): GraphEdge => ({ a, b, amount });

const at = (laid: LaidNode[], id: string): LaidNode => {
  const hit = laid.find((p) => p.id === id);
  if (hit === undefined) throw new Error(`node ${id} was not laid out`);
  return hit;
};

describe("nodeRadius — stones grow on a fixed scale, like the heatmap's levels", () => {
  it("grows monotonically with 量 and saturates", () => {
    expect(nodeRadius(1)).toBeLessThan(nodeRadius(4));
    expect(nodeRadius(4)).toBeLessThan(nodeRadius(25));
    expect(nodeRadius(1000)).toBe(nodeRadius(10_000));
  });

  it("keeps a one-苔片 stone visible, and a clipped fraction of one smaller still", () => {
    expect(nodeRadius(1)).toBeGreaterThanOrEqual(7);
    expect(nodeRadius(0.6)).toBeLessThan(nodeRadius(1));
    expect(nodeRadius(0.6)).toBeGreaterThanOrEqual(7);
  });
});

describe("edgeWidth", () => {
  it("thickens monotonically with shared 量 and saturates", () => {
    expect(edgeWidth(1)).toBeLessThan(edgeWidth(4));
    expect(edgeWidth(4)).toBeLessThan(edgeWidth(16));
    expect(edgeWidth(100)).toBe(edgeWidth(1000));
  });
});

describe("layoutGraph", () => {
  it("is deterministic — the same garden draws the same map", () => {
    const nodes = [node("a", 9), node("b", 4), node("c", 1), node("d", 2)];
    const edges = [edge("a", "b", 3), edge("a", "c")];
    expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges));
  });

  it("keeps every stone, plus its label line, inside the frame", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(`t${String(i).padStart(2, "0")}`, (i % 7) + 1));
    const edges = nodes.slice(1, 12).map((n, i) => edge("t00", n.id, i + 1));
    const laid = layoutGraph(nodes, edges);
    expect(laid).toHaveLength(30);
    for (const p of laid) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0);
      expect(p.x + p.r).toBeLessThanOrEqual(VIEW_W);
      expect(p.y - p.r).toBeGreaterThanOrEqual(0);
      // Room below every stone for its name.
      expect(p.y + p.r).toBeLessThanOrEqual(VIEW_H - 20);
    }
  });

  it("pulls bridged stones together: the one bridged pair ends closest", () => {
    const nodes = [node("a", 3), node("b", 3), node("c", 3), node("d", 3)];
    const laid = layoutGraph(nodes, [edge("a", "b", 2)]);
    const dist = (i: string, j: string) =>
      Math.hypot(at(laid, i).x - at(laid, j).x, at(laid, i).y - at(laid, j).y);
    const bridged = dist("a", "b");
    for (const [i, j] of [
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
      ["b", "d"],
      ["c", "d"],
    ] as const) {
      expect(bridged).toBeLessThan(dist(i, j));
    }
  });

  it("lets a lone stone come to rest near the centre, not pinned to a wall", () => {
    const laid = layoutGraph([node("a", 1)], []);
    const p = at(laid, "a");
    expect(Math.abs(p.x - VIEW_W / 2)).toBeLessThan(40);
    expect(Math.abs(p.y - VIEW_H / 2)).toBeLessThan(40);
  });
});

describe("TagGraphChart markup", () => {
  const graph: TagGraph = { nodes: [node("a", 5), node("b", 1)], edges: [edge("a", "b", 2)] };
  const render = (selected: { id: string; name: string }[]) =>
    renderToStaticMarkup(
      <TagGraphChart
        graph={graph}
        selected={selected}
        onStoneTap={() => {}}
        onBridgeTap={() => {}}
      />,
    );
  const html = render([]);

  it("offers each stone as a keyboard-reachable button named with its 量", () => {
    expect(html).toContain('aria-label="A · 量 5"');
    expect(html).toContain('aria-label="B · 量 1"');
    // 2 stones + 1 bridge: every tappable thing is a real tab stop.
    expect(html.match(/role="button"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
  });

  it("is a set of toggle buttons: nothing pressed until a stone is chosen", () => {
    // aria-pressed is what makes them toggles (選んだ石, features.md §3), and
    // the CSS reads the same attribute — so it is always present, true or false.
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("presses the chosen stones, and a bridge only once both its ends are chosen", () => {
    const one = render([{ id: "a", name: "A" }]);
    expect(one).toMatch(/aria-pressed="true" aria-label="A · 量 5"/);
    expect(one).toMatch(/aria-pressed="false" aria-label="B · 量 1"/);
    expect(one).toMatch(/aria-pressed="false" aria-label="A × B · 量 2"/);
    const both = render([
      { id: "b", name: "B" },
      { id: "a", name: "A" },
    ]);
    expect(both.match(/aria-pressed="true"/g)).toHaveLength(3);
  });

  it("sizes stones by their 量 and bridges by the 量 they share", () => {
    expect(html).toContain(`r="${nodeRadius(5)}"`);
    expect(html).toContain(`r="${nodeRadius(1)}"`);
    expect(html).toContain(`stroke-width="${edgeWidth(2)}"`);
  });

  it("names a stone's fractional 量 rounded for display only — 438.6 reads 量 439", () => {
    const thick: TagGraph = { nodes: [node("案件", 438.6), node("memo", 0.5)], edges: [edge("案件", "memo", 0.5)] };
    const html2 = renderToStaticMarkup(
      <TagGraphChart graph={thick} selected={[]} onStoneTap={() => {}} onBridgeTap={() => {}} />,
    );
    expect(html2).toContain('aria-label="案件 · 量 439"');
    expect(html2).toContain('aria-label="MEMO · 量 0.5"');
    expect(html2).toContain('aria-label="案件 × MEMO · 量 0.5"');
    expect(html2).toContain(`r="${nodeRadius(438.6)}"`);
  });

  it("offers the bridge as a button named with the pair, with a fat hit stroke", () => {
    // Its landing is the 両タグ post list; a hairline bridge stays tappable
    // through the transparent 14px hit line.
    expect(html).toContain('aria-label="A × B · 量 2"');
    expect(html).toContain("<title>A × B · 量 2</title>");
    expect(html).toContain('class="tg-hit-line"');
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("writes each stone's name under it", () => {
    expect(html).toContain(">A</text>");
    expect(html).toContain(">B</text>");
  });
});
