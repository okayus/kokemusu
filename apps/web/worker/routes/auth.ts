import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { and, count, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import { credential, user } from "../db/schema";
import { fromBase64Url, toBase64Url, utf8Bytes } from "../lib/base64url";
import { fail } from "../lib/errors";
import { getSessionSecret } from "../lib/secret";
import { consumeChallenge, issueChallenge } from "../middleware/challenge-cookie";
import { authRateLimit } from "../middleware/rate-limit";
import { issueSession, revokeSession, sessionMiddleware } from "../middleware/session";
import type { Env } from "../types";

// Shown by the authenticator UI when saving the passkey. Not configuration —
// it is the app's name.
const RP_NAME = "苔むす";

const displayNameSchema = z.string().trim().min(1).max(64);
const deviceNameSchema = z.string().trim().min(1).max(64);
const registerBeginSchema = z.object({
  displayName: displayNameSchema,
  initialRegistrationToken: z.string().min(1).max(256),
});
// Only `id` is read server-side (the credential lookup); the rest passes
// through to @simplewebauthn, which fully validates the ceremony itself.
const webauthnResponseSchema = z.looseObject({ id: z.string().min(1).max(1024) });
const registrationVerifySchema = z.object({
  response: webauthnResponseSchema,
  deviceName: deviceNameSchema.optional(),
});
const loginVerifySchema = z.object({ response: webauthnResponseSchema });
const credentialIdSchema = z.string().min(1).max(1024);

// The registration token is compared in constant time. The length short-cut
// leaks only the length, and the token is high-entropy (openssl rand -hex 32).
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function parseTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  return json ? (JSON.parse(json) as AuthenticatorTransportFuture[]) : undefined;
}

function toDescriptor(row: { id: string; transports: string | null }) {
  const transports = parseTransports(row.transports);
  return { id: row.id, ...(transports ? { transports } : {}) };
}

function toWebAuthnCredential(row: typeof credential.$inferSelect): WebAuthnCredential {
  const transports = parseTransports(row.transports);
  return {
    id: row.id,
    publicKey: fromBase64Url(row.publicKey),
    counter: row.counter,
    ...(transports ? { transports } : {}),
  };
}

const registrationOptionsFor = (
  env: Env["Bindings"],
  userId: string,
  displayName: string,
  exclude: { id: string; transports: string | null }[],
) =>
  generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: env.RP_ID,
    userID: utf8Bytes(userId),
    userName: displayName,
    userDisplayName: displayName,
    attestationType: "none",
    // Authenticators that already hold one of these refuse with
    // InvalidStateError instead of silently creating a duplicate passkey.
    excludeCredentials: exclude.map(toDescriptor),
    // residentKey: "required" = discoverable credential = username-less login.
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });

// Shared by register/verify and credentials/add/verify. Returns the
// registrationInfo on success, null on any ceremony failure.
async function verifyRegistrationCeremony(
  c: Context<Env>,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
) {
  try {
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      // Byte-for-byte the browser origin, port included — a mismatch fails
      // every verify while begin keeps succeeding.
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: false,
    });
    return v.verified ? v.registrationInfo : null;
  } catch {
    return null;
  }
}

export const authRoutes = new Hono<Env>()
  // ------------------------------------------------------------ register (PUBLIC)
  .post("/register/begin", authRateLimit, async (c) => {
    // Door first: an unset secret closes registration entirely — including
    // the window right after a fresh deploy (fail closed, any request body).
    const expectedToken = c.env.INITIAL_REGISTRATION_TOKEN;
    if (!expectedToken) return fail(c, "registration_closed");

    const parsed = registerBeginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    if (!timingSafeEqualStr(parsed.data.initialRegistrationToken, expectedToken)) {
      return fail(c, "registration_closed");
    }
    if (!getSessionSecret(c.env)) return fail(c, "auth_not_configured");

    // Single-user rule (plans/vertical-slice.md PR2): when the `user` row
    // already exists — all-passkeys-lost recovery, a future RP_ID change —
    // this registration adds a credential to it instead of minting a new
    // user, whose `post` rows would otherwise all orphan. The row's id also
    // becomes the WebAuthn user handle, and its display name wins.
    const db = createDb(c.env.DB);
    const existing = (await db.select().from(user).limit(1))[0];
    const uid = existing?.id ?? crypto.randomUUID();
    const displayName = existing?.displayName ?? parsed.data.displayName;
    const exclude = existing
      ? await db
          .select({ id: credential.id, transports: credential.transports })
          .from(credential)
          .where(eq(credential.userId, existing.id))
      : [];

    const options = await registrationOptionsFor(c.env, uid, displayName, exclude);
    await issueChallenge(c, options.challenge, { kind: "initial", uid, displayName });
    return c.json({ options });
  })
  .post("/register/verify", authRateLimit, async (c) => {
    const parsed = registrationVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    // The challenge cookie exists only if register/begin accepted the token,
    // so the door is not re-checked here.
    const ch = await consumeChallenge(c);
    if (!ch || ch.state.kind !== "initial") return fail(c, "challenge_mismatch");

    const info = await verifyRegistrationCeremony(
      c,
      parsed.data.response as unknown as RegistrationResponseJSON,
      ch.challenge,
    );
    if (!info) return fail(c, "challenge_mismatch");

    const db = createDb(c.env.DB);
    const now = Date.now();
    // Re-checked at verify: the single-user rule is absolute, so a row that
    // appeared since begin still wins over the uid in the challenge state.
    const existing = (await db.select().from(user).limit(1))[0];
    const userId = existing?.id ?? ch.state.uid;
    const newCredential: typeof credential.$inferInsert = {
      id: info.credential.id,
      userId,
      publicKey: toBase64Url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
      deviceName: parsed.data.deviceName ?? null,
      backedUp: info.credentialBackedUp,
      createdAt: now,
      lastUsedAt: now,
    };
    if (existing) {
      await db.insert(credential).values(newCredential);
    } else {
      await db.batch([
        db.insert(user).values({ id: userId, displayName: ch.state.displayName, createdAt: now }),
        db.insert(credential).values(newCredential),
      ]);
    }

    await issueSession(c, userId);
    return c.json({ id: userId, displayName: existing?.displayName ?? ch.state.displayName }, 201);
  })
  // ------------------------------------------------------------ login (PUBLIC)
  .post("/login/begin", authRateLimit, async (c) => {
    if (!getSessionSecret(c.env)) return fail(c, "auth_not_configured");
    // No allowCredentials -> the browser shows its passkey picker.
    const options = await generateAuthenticationOptions({
      rpID: c.env.RP_ID,
      userVerification: "preferred",
    });
    await issueChallenge(c, options.challenge, { kind: "authentication" });
    return c.json({ options });
  })
  .post("/login/verify", authRateLimit, async (c) => {
    const parsed = loginVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    const ch = await consumeChallenge(c);
    if (!ch || ch.state.kind !== "authentication") return fail(c, "challenge_mismatch");

    const db = createDb(c.env.DB);
    const rows = await db
      .select({ cred: credential, displayName: user.displayName })
      .from(credential)
      .innerJoin(user, eq(credential.userId, user.id))
      .where(eq(credential.id, parsed.data.response.id));
    const row = rows[0];
    if (!row) return fail(c, "not_found", "Credential not registered");

    let verified: boolean;
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: parsed.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: ch.challenge,
        expectedOrigin: c.env.ORIGIN,
        expectedRPID: c.env.RP_ID,
        credential: toWebAuthnCredential(row.cred),
        requireUserVerification: false,
      });
      verified = v.verified;
      newCounter = v.authenticationInfo.newCounter;
    } catch {
      return fail(c, "challenge_mismatch");
    }
    if (!verified) return fail(c, "challenge_mismatch");

    // Counter regression guard, only when the stored value is non-zero:
    // synced passkeys (iCloud / Google) report 0 forever, and a strict <=
    // would lock out every iPhone. @simplewebauthn 13.3.2 applies the same
    // rule internally; this stays as belt-and-braces.
    if (row.cred.counter !== 0 && newCounter <= row.cred.counter) {
      return fail(c, "unauthorized", "Authenticator counter regression");
    }

    await db
      .update(credential)
      .set({ counter: newCounter, lastUsedAt: Date.now() })
      .where(eq(credential.id, row.cred.id));
    await issueSession(c, row.cred.userId);
    return c.json({ id: row.cred.userId, displayName: row.displayName });
  })
  // ------------------------------------------------------------ session-only
  .post("/logout", sessionMiddleware(), async (c) => {
    await revokeSession(c);
    return c.json({});
  })
  .get("/me", sessionMiddleware(), (c) =>
    c.json({ id: c.get("userId"), displayName: c.get("displayName") }),
  )
  .get("/credentials", sessionMiddleware(), async (c) => {
    const rows = await createDb(c.env.DB)
      .select({
        id: credential.id,
        deviceName: credential.deviceName,
        backedUp: credential.backedUp,
        createdAt: credential.createdAt,
        lastUsedAt: credential.lastUsedAt,
      })
      .from(credential)
      .where(eq(credential.userId, c.get("userId")));
    return c.json(rows);
  })
  .post("/credentials/add/begin", sessionMiddleware(), async (c) => {
    const userId = c.get("userId");
    const db = createDb(c.env.DB);
    const exclude = await db
      .select({ id: credential.id, transports: credential.transports })
      .from(credential)
      .where(eq(credential.userId, userId));

    const options = await registrationOptionsFor(c.env, userId, c.get("displayName"), exclude);
    await issueChallenge(c, options.challenge, { kind: "add-credential", uid: userId });
    return c.json({ options });
  })
  .post("/credentials/add/verify", sessionMiddleware(), async (c) => {
    const parsed = registrationVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    const ch = await consumeChallenge(c);
    if (!ch || ch.state.kind !== "add-credential" || ch.state.uid !== c.get("userId")) {
      return fail(c, "challenge_mismatch");
    }

    const info = await verifyRegistrationCeremony(
      c,
      parsed.data.response as unknown as RegistrationResponseJSON,
      ch.challenge,
    );
    if (!info) return fail(c, "challenge_mismatch");

    await createDb(c.env.DB)
      .insert(credential)
      .values({
        id: info.credential.id,
        userId: c.get("userId"),
        publicKey: toBase64Url(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
        deviceName: parsed.data.deviceName ?? null,
        backedUp: info.credentialBackedUp,
        createdAt: Date.now(),
        lastUsedAt: null,
      });
    return c.json({ id: info.credential.id }, 201);
  })
  .delete("/credentials/:id", sessionMiddleware(), async (c) => {
    const id = credentialIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, "validation_error");
    const userId = c.get("userId");
    const db = createDb(c.env.DB);

    // Without a passkey this account is unrecoverable except via the
    // INITIAL_REGISTRATION_TOKEN runbook — refuse to delete the last one.
    const countRows = await db
      .select({ n: count() })
      .from(credential)
      .where(eq(credential.userId, userId));
    if ((countRows[0]?.n ?? 0) <= 1) {
      return fail(c, "last_credential", "Cannot delete the last passkey");
    }

    const deleted = await db
      .delete(credential)
      .where(and(eq(credential.id, id.data), eq(credential.userId, userId)))
      .returning({ id: credential.id });
    if (deleted.length === 0) return fail(c, "not_found");
    return c.json({});
  });
