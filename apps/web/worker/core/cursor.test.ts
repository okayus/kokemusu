import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const CURSOR = { createdAt: 1756700000000, id: "0f2c8f9e-7d39-4a56-9b1f-1234567890ab" };

describe("cursor round-trip", () => {
  it("encodes to a single base64url token and decodes back", () => {
    const token = encodeCursor(CURSOR);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(CURSOR);
  });

  it("survives non-ASCII ids (encoding is utf-8, not btoa-on-utf16)", () => {
    const c = { createdAt: 1, id: "苔-id" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
});

describe("decodeCursor rejects everything that is not a cursor", () => {
  const b64 = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("garbage that is not base64url", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });

  it("valid base64url of non-JSON bytes", () => {
    expect(decodeCursor("AAAA")).toBeNull();
  });

  it("JSON of the wrong shape", () => {
    expect(decodeCursor(b64("[]"))).toBeNull();
    expect(decodeCursor(b64("null"))).toBeNull();
    expect(decodeCursor(b64('{"createdAt":"1","id":"x"}'))).toBeNull();
    expect(decodeCursor(b64('{"createdAt":1}'))).toBeNull();
  });

  it("out-of-domain values: negative, fractional, unsafe, empty or oversized id", () => {
    expect(decodeCursor(b64('{"createdAt":-1,"id":"x"}'))).toBeNull();
    expect(decodeCursor(b64('{"createdAt":1.5,"id":"x"}'))).toBeNull();
    expect(decodeCursor(b64('{"createdAt":9007199254740993,"id":"x"}'))).toBeNull();
    expect(decodeCursor(b64('{"createdAt":1,"id":""}'))).toBeNull();
    expect(decodeCursor(b64(`{"createdAt":1,"id":"${"x".repeat(65)}"}`))).toBeNull();
  });
});
