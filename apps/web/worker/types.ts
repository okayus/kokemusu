// Single source of truth for the Worker's bindings. Every other worker file
// imports this type; never re-declare it inline.
export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  // WebAuthn relying party, locked in wrangler.jsonc (see the comment there).
  RP_ID: string;
  ORIGIN: string;
};
