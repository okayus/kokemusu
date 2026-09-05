import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const CURSOR = {
  firstDay: "2026-09-01",
  createdAt: 1756700000000,
  id: "0f2c8f9e-7d39-4a56-9b1f-1234567890ab",
};

describe("cursor round-trip", () => {
  it("encodes to a single base64url token and decodes back", () => {
    const token = encodeCursor(CURSOR);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(CURSOR);
  });

  it("survives non-ASCII ids (encoding is utf-8, not btoa-on-utf16)", () => {
    const c = { ...CURSOR, createdAt: 1, id: "苔-id" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
});

describe("decodeCursor rejects everything that is not a cursor", () => {
  const b64 = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const json = (fields: Record<string, unknown>) => b64(JSON.stringify({ ...CURSOR, ...fields }));

  it("garbage that is not base64url", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });

  it("valid base64url of non-JSON bytes", () => {
    expect(decodeCursor("AAAA")).toBeNull();
  });

  it("JSON of the wrong shape", () => {
    expect(decodeCursor(b64("[]"))).toBeNull();
    expect(decodeCursor(b64("null"))).toBeNull();
    expect(decodeCursor(json({ createdAt: "1" }))).toBeNull();
    expect(decodeCursor(b64('{"firstDay":"2026-09-01","createdAt":1}'))).toBeNull();
    // The pre-ADR-0005 two-field cursor: a stale client token is a 400, not a guess.
    expect(decodeCursor(b64('{"createdAt":1,"id":"x"}'))).toBeNull();
  });

  it("a firstDay that is not a calendar day — the string reaches SQL as a comparison, so it must be one", () => {
    expect(decodeCursor(json({ firstDay: "2026-02-30" }))).toBeNull();
    expect(decodeCursor(json({ firstDay: "2026-9-1" }))).toBeNull();
    expect(decodeCursor(json({ firstDay: "" }))).toBeNull();
    expect(decodeCursor(json({ firstDay: 20260901 }))).toBeNull();
  });

  it("out-of-domain values: negative, fractional, unsafe, empty or oversized id", () => {
    expect(decodeCursor(json({ createdAt: -1 }))).toBeNull();
    expect(decodeCursor(json({ createdAt: 1.5 }))).toBeNull();
    expect(decodeCursor(json({ createdAt: 9007199254740993 }))).toBeNull();
    expect(decodeCursor(json({ id: "" }))).toBeNull();
    expect(decodeCursor(json({ id: "x".repeat(65) }))).toBeNull();
  });
});
