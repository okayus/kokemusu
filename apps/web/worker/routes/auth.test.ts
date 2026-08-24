import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, TEST_SECRET, testEnv } from "../test-support";

// None of these tests touch D1 (testEnv has no DB) — every asserted branch
// answers before the first query. DB-backed flows (register/verify happy path,
// login/verify, sliding expiry) are e2e/production territory (PR6).

const json = (path: string, body: unknown, env = testEnv(), cookie?: string) =>
  app.request(
    path,
    {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
        ...(cookie === undefined ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    },
    env,
  );

const errType = async (res: Response) =>
  ((await res.json()) as { error: { type: string } }).error.type;

const futureExp = () => Math.floor(Date.now() / 1000) + 60;

describe("register/begin — the closed door", () => {
  const body = { displayName: "苔", initialRegistrationToken: "tok" };

  it("403 registration_closed when INITIAL_REGISTRATION_TOKEN is unset (any body)", async () => {
    const res = await json("/api/auth/register/begin", body);
    expect(res.status).toBe(403);
    expect(await errType(res)).toBe("registration_closed");
  });

  it("403 registration_closed on a token mismatch", async () => {
    const env = testEnv({ INITIAL_REGISTRATION_TOKEN: "other" });
    const res = await json("/api/auth/register/begin", body, env);
    expect(res.status).toBe(403);
  });

  it("400 validation_error on a malformed body once the door exists", async () => {
    const env = testEnv({ INITIAL_REGISTRATION_TOKEN: "tok" });
    const res = await json("/api/auth/register/begin", { displayName: "" }, env);
    expect(res.status).toBe(400);
    expect(await errType(res)).toBe("validation_error");
  });

  it("503 auth_not_configured when the token matches but SESSION_SECRET is unset", async () => {
    const env = testEnv({ INITIAL_REGISTRATION_TOKEN: "tok", SESSION_SECRET: undefined });
    const res = await json("/api/auth/register/begin", body, env);
    expect(res.status).toBe(503);
    expect(await errType(res)).toBe("auth_not_configured");
  });

  it("a too-short SESSION_SECRET counts as unset (fail closed)", async () => {
    const env = testEnv({ INITIAL_REGISTRATION_TOKEN: "tok", SESSION_SECRET: "weak" });
    const res = await json("/api/auth/register/begin", body, env);
    expect(res.status).toBe(503);
  });
});

describe("login/begin", () => {
  it("503 auth_not_configured without SESSION_SECRET", async () => {
    const res = await json("/api/auth/login/begin", undefined, testEnv({ SESSION_SECRET: undefined }));
    expect(res.status).toBe(503);
  });

  it("returns WebAuthn options and sets the challenge cookie (http shape)", async () => {
    const res = await json("/api/auth/login/begin", undefined);
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { challenge: string; rpId: string } };
    expect(typeof options.challenge).toBe("string");
    expect(options.rpId).toBe("localhost");

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0] ?? "";
    // http origin -> bare name, no Secure; always HttpOnly, Lax, 5 min.
    expect(cookie).toMatch(/^challenge=/);
    expect(cookie).toContain("Max-Age=300");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toContain("Domain");
  });

  it("uses __Host- and Secure over an https ORIGIN", async () => {
    const env = testEnv({
      RP_ID: "kokemusu.shiraoka.workers.dev",
      ORIGIN: "https://kokemusu.shiraoka.workers.dev",
    });
    const res = await app.request(
      "/api/auth/login/begin",
      { method: "POST", headers: { Origin: "https://kokemusu.shiraoka.workers.dev" } },
      env,
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie()[0] ?? "";
    expect(cookie).toMatch(/^__Host-challenge=/);
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain");
  });
});

describe("challenge cookie validation on verify", () => {
  const response = { response: { id: "some-credential-id" } };

  it("login/verify without a challenge cookie -> 400 challenge_mismatch", async () => {
    const res = await json("/api/auth/login/verify", response);
    expect(res.status).toBe(400);
    expect(await errType(res)).toBe("challenge_mismatch");
  });

  it("a session-audience JWT cannot be replayed as a challenge", async () => {
    const forged = await sign(
      { challenge: "x", state: { kind: "authentication" }, aud: "kokemusu:session", exp: futureExp() },
      TEST_SECRET,
    );
    const res = await json("/api/auth/login/verify", response, testEnv(), `challenge=${forged}`);
    expect(res.status).toBe(400);
    expect(await errType(res)).toBe("challenge_mismatch");
  });

  it("an expired challenge cookie is rejected (hono/jwt verify checks exp)", async () => {
    const expired = await sign(
      {
        challenge: "x",
        state: { kind: "authentication" },
        aud: "kokemusu:challenge",
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      TEST_SECRET,
    );
    const res = await json("/api/auth/login/verify", response, testEnv(), `challenge=${expired}`);
    expect(res.status).toBe(400);
  });

  it("a challenge signed with a different secret is rejected", async () => {
    const foreign = await sign(
      { challenge: "x", state: { kind: "authentication" }, aud: "kokemusu:challenge", exp: futureExp() },
      "another-secret-another-secret-another-secret",
    );
    const res = await json("/api/auth/login/verify", response, testEnv(), `challenge=${foreign}`);
    expect(res.status).toBe(400);
  });

  it("register/verify refuses a challenge of the wrong kind", async () => {
    const wrongKind = await sign(
      { challenge: "x", state: { kind: "authentication" }, aud: "kokemusu:challenge", exp: futureExp() },
      TEST_SECRET,
    );
    const res = await json(
      "/api/auth/register/verify",
      response,
      testEnv(),
      `challenge=${wrongKind}`,
    );
    expect(res.status).toBe(400);
    expect(await errType(res)).toBe("challenge_mismatch");
  });
});

describe("session-guarded routes fail closed", () => {
  it.each([
    ["GET", "/api/auth/me"],
    ["GET", "/api/auth/credentials"],
    ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/credentials/add/begin"],
    ["DELETE", "/api/auth/credentials/some-id"],
    // The protected catch-all guards every future /api route too.
    ["POST", "/api/posts"],
    ["GET", "/api/anything"],
  ])("%s %s -> 401 without a session cookie", async (method, path) => {
    const res = await app.request(
      path,
      { method, headers: { Origin: TEST_ORIGIN } },
      testEnv(),
    );
    expect(res.status).toBe(401);
    expect(await errType(res)).toBe("unauthorized");
  });

  it("a garbage session cookie is 401, not 500", async () => {
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: "session=not-a-jwt" } },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("an unset SESSION_SECRET rejects every session before touching D1", async () => {
    const forged = await sign(
      { sid: "some-sid", aud: "kokemusu:session", exp: futureExp() },
      TEST_SECRET,
    );
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `session=${forged}` } },
      testEnv({ SESSION_SECRET: undefined }),
    );
    expect(res.status).toBe(401);
  });

  it("a challenge-audience JWT cannot be used as a session", async () => {
    const forged = await sign(
      { sid: "some-sid", aud: "kokemusu:challenge", exp: futureExp() },
      TEST_SECRET,
    );
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `session=${forged}` } },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });
});
