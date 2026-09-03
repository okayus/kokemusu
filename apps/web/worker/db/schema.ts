// Kokemusu schema — the shape of docs/data-model.md, in Drizzle form.
//
// Two rules this file is built around (docs/plans/vertical-slice.md, skill
// `cloudflare-d1-drizzle-migration`):
//
//  1. Migrations stay ADDITIVE. D1 ignores `PRAGMA foreign_keys=OFF`, so any
//     change that rebuilds a table (NULL → NOT NULL, type change, rename)
//     emits `DROP TABLE <parent>` and cascade-deletes every child row. `user`,
//     `post` and `tag` are CASCADE parents, so their NOT NULL columns are
//     decided here and never touched again. Adding a NULLABLE column, a new
//     leaf table or an index is safe.
//  2. Timestamps are epoch ms in a plain `integer` (docs/data-model.md 規約),
//     not Drizzle's `timestamp_ms` mode: the domain functions (`dayKey`) take
//     numbers, and the wire format stays JSON-native.
//
// Deliberately NOT here — all leaf tables, addable later without a rebuild:
// `tag_alias` (Phase 2), `attachment` (Phase 4). `api_token` joined in 0002
// exactly that way (additive: one CREATE TABLE + two indexes).

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** The single user of this instance. Passkey-only, so no password column. */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A registered WebAuthn passkey. `id` is the credential ID itself, not a UUID. */
export const credential = sqliteTable(
  "credential",
  {
    // base64url credential ID — what `login/verify` looks up from `response.id`.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // COSE public key, base64url. Text rather than BLOB so a `d1 execute` dump
    // stays readable.
    publicKey: text("public_key").notNull(),
    // Signature counter. Synced passkeys (iCloud / Google) always report 0, so
    // the regression check must run only when the stored value is non-zero.
    counter: integer("counter").notNull(),
    // JSON array of AuthenticatorTransport ("internal" / "hybrid" / …).
    transports: text("transports"),
    deviceName: text("device_name"),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("credential_user_id_idx").on(t.userId)],
);

/**
 * Server-side backing for the session JWT: the `sid` claim is this row's id, so
 * deleting the row revokes the session immediately. 30-day sliding expiry.
 * WebAuthn challenges get no table — they live in a signed 5-minute cookie.
 */
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("session_user_id_idx").on(t.userId),
    // Cron sweep of expired rows.
    index("session_expires_at_idx").on(t.expiresAt),
  ],
);

/**
 * Personal access token for API 自動投稿 (features.md §7, ADR-0002). The raw
 * token — `kokemusu_pat_` + base64url(32 random bytes) — is shown once at mint
 * time and never stored: `token_hash` is sha256(token + PAT_PEPPER) hex, so a
 * D1 dump holds no live credential. `revoked_at` is a soft flag; the row stays
 * as the audit trail (name / created / last used / when it died).
 */
export const apiToken = sqliteTable(
  "api_token",
  {
    // Public id (the settings list and DELETE /api/tokens/:id) — NOT the token.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // User-chosen label, e.g. "mazuoboeru".
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    // JSON array of Scope (core/pat.ts). Unknown entries are dropped on parse.
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at").notNull(),
    // Throttled to ≤ 1 write per hour per token (core/pat.ts shouldTouchLastUsed).
    lastUsedAt: integer("last_used_at"),
    // null = no expiry (the senders are long-running Workers; revocation is the control).
    expiresAt: integer("expires_at"),
    // null = live. Set instead of DELETE so "いつ死んだか" stays visible.
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    // The auth hot path: one indexed point read per Bearer request.
    uniqueIndex("api_token_token_hash_unq").on(t.tokenHash),
    // The settings list.
    index("api_token_user_id_revoked_at_idx").on(t.userId, t.revokedAt),
  ],
);

/** 苔片 — one entry. Body and title are ciphertext; everything else is plaintext. */
export const post = sqliteTable(
  "post",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Optional heading, same envelope and key as the body. null = no heading.
    title: text("title"),
    // `k<keyId>.<iv>.<ciphertext>` (ADR-0001). Plaintext never reaches D1.
    body: text("body").notNull(),
    // Plaintext metadata describing how the DECRYPTED body should be read.
    bodyFormat: text("body_format").notNull().default("markdown"),
    // Epoch ms. Plaintext on purpose — this is the axis every visualization is
    // built on. The "day" it falls in is decided by `dayKey()` in Asia/Tokyo,
    // never by SQLite's UTC-based `date()`.
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    // ADR-0003: deletion is physical, so nothing ever writes this (always
    // NULL). Kept only until a follow-up migration drops the index, then the
    // column — dropping is a schema change and rides its own reviewed PR.
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("post_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("post_deleted_at_idx").on(t.deletedAt),
  ],
);

/** A tag (石). `norm` absorbs the ways the same tag gets typed. */
export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Display form — whatever spelling created the tag first ("TypeScript").
    name: text("name").notNull(),
    // trim + NFKC + toLowerCase, computed in `normalizeTagName`. Unique per
    // user, so "TypeScript" / "typescript" / " typescript " land on one stone.
    // `COLLATE NOCASE` would only fold ASCII case, missing e.g. "ＴＳ".
    norm: text("norm").notNull(),
    color: text("color"),
    emoji: text("emoji"),
    description: text("description"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("tag_user_id_norm_unq").on(t.userId, t.norm)],
);

/**
 * post ↔ tag. The composite primary key already gives SQLite an implicit index
 * over (post_id, tag_id), which covers every `WHERE post_id = ?` lookup — so
 * only the reverse direction needs an explicit index.
 */
export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index("post_tags_tag_id_idx").on(t.tagId),
  ],
);
