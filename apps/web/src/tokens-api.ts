// Browser side of PAT management (features.md §7). Minting is the only call
// that ever sees the raw token, in its 201 response — keep it in component
// state, never in a store, the URL or localStorage.
import { postJson, request } from "./api";

export type TokenSummary = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
};

/** The 201 body of a mint — `token` is the raw credential, shown once. */
export type CreatedToken = {
  id: string;
  name: string;
  token: string;
  scopes: string[];
  createdAt: number;
};

export const listTokens = (): Promise<TokenSummary[]> => request("/api/tokens");

export const createToken = (name: string): Promise<CreatedToken> =>
  postJson("/api/tokens", { name });

export const revokeToken = (id: string): Promise<Record<string, never>> =>
  request(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
