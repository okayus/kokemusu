import { describe, expect, it } from "vitest";
import { togglePair, toggleStone } from "./stones";

const stone = (id: string) => ({ id, name: id.toUpperCase() });
const ids = (stones: { id: string }[]) => stones.map((s) => s.id);

describe("toggleStone — a tap adds, the same tap again takes away", () => {
  it("appends a stone that is not there, keeping the order of the rest", () => {
    expect(ids(toggleStone([stone("a")], stone("b")))).toEqual(["a", "b"]);
    expect(ids(toggleStone([], stone("a")))).toEqual(["a"]);
  });

  it("removes a stone that is there, whatever spelling of it comes back", () => {
    const current = [stone("a"), stone("b"), stone("c")];
    expect(ids(toggleStone(current, { id: "b", name: "other spelling" }))).toEqual(["a", "c"]);
  });

  it("never mutates the array it was given", () => {
    const current = [stone("a")];
    toggleStone(current, stone("b"));
    toggleStone(current, stone("a"));
    expect(ids(current)).toEqual(["a"]);
  });
});

describe("togglePair — a bridge toggles both ends as one", () => {
  it("adds both ends after what was there", () => {
    expect(ids(togglePair([], stone("a"), stone("b")))).toEqual(["a", "b"]);
    expect(ids(togglePair([stone("c")], stone("a"), stone("b")))).toEqual(["c", "a", "b"]);
  });

  it("adds only the missing end when one is already chosen", () => {
    expect(ids(togglePair([stone("b")], stone("a"), stone("b")))).toEqual(["b", "a"]);
  });

  it("takes both out when both are chosen, leaving the others in place", () => {
    const current = [stone("a"), stone("c"), stone("b")];
    expect(ids(togglePair(current, stone("a"), stone("b")))).toEqual(["c"]);
  });
});
