import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  LAST_USED_THROTTLE_MS,
  parseScopes,
  PAT_PREFIX,
  PAT_TOKEN_BYTES,
  patTokenFromBytes,
  sha256Hex,
  shouldTouchLastUsed,
  tokenState,
} from "./pat";

describe("patTokenFromBytes", () => {
  it("prefixes and base64url-encodes: 32 bytes -> 43 chars, no padding", () => {
    const token = patTokenFromBytes(new Uint8Array(PAT_TOKEN_BYTES));
    expect(token.startsWith(PAT_PREFIX)).toBe(true);
    expect(token.slice(PAT_PREFIX.length)).toHaveLength(43);
    expect(token).toMatch(/^kokemusu_pat_[A-Za-z0-9_-]+$/);
  });

  it("is deterministic over the bytes (the randomness lives at the boundary)", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(patTokenFromBytes(bytes)).toBe(patTokenFromBytes(bytes));
  });
});

describe("extractBearerToken", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["Basic dXNlcjpwdw==", null],
    // Case-sensitive on purpose (our senders always send the canonical form).
    ["bearer kokemusu_pat_x", null],
    ["Bearer kokemusu_pat_x", "kokemusu_pat_x"],
    // Surrounding whitespace after the scheme is tolerated.
    ["Bearer  kokemusu_pat_x ", "kokemusu_pat_x"],
  ])("%j -> %j", (header, want) => {
    expect(extractBearerToken(header)).toBe(want);
  });
});

describe("parseScopes — fail closed on permissions, never throw", () => {
  it.each([
    ['["post:write"]', ["post:write"]],
    // Unknown scopes (renamed, or from a future build) are dropped.
    ['["post:write","quiz:read"]', ["post:write"]],
    ['["post:wrte"]', []],
    ["not json", []],
    ['"post:write"', []],
    ["[1,2]", []],
    ["{}", []],
  ])("%s -> %j", (json, want) => {
    expect(parseScopes(json)).toEqual(want);
  });
});

describe("tokenState", () => {
  const now = 1_700_000_000_000;
  it.each([
    [{ revokedAt: null, expiresAt: null }, "live"],
    [{ revokedAt: null, expiresAt: now + 1 }, "live"],
    // Boundary: expires_at === now is still live (strictly-less comparison).
    [{ revokedAt: null, expiresAt: now }, "live"],
    [{ revokedAt: null, expiresAt: now - 1 }, "expired"],
    [{ revokedAt: now - 5, expiresAt: null }, "revoked"],
    // Revocation wins over expiry.
    [{ revokedAt: now - 5, expiresAt: now - 5 }, "revoked"],
  ])("%j -> %s", (row, want) => {
    expect(tokenState(row, now)).toBe(want);
  });
});

describe("shouldTouchLastUsed — at most one D1 write per hour per token", () => {
  const now = 1_700_000_000_000;
  it.each([
    [null, true],
    [now - LAST_USED_THROTTLE_MS - 1, true],
    // Boundary: exactly one hour ago is NOT yet stale (strictly-greater).
    [now - LAST_USED_THROTTLE_MS, false],
    [now - 1, false],
  ])("lastUsedAt=%j -> %j", (lastUsedAt, want) => {
    expect(shouldTouchLastUsed(lastUsedAt, now)).toBe(want);
  });
});

describe("sha256Hex", () => {
  it("matches the known sha256 vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("pepper concatenation changes the digest (the whole point of the pepper)", async () => {
    expect(await sha256Hex("token" + "pepper-a")).not.toBe(await sha256Hex("token" + "pepper-b"));
  });
});
