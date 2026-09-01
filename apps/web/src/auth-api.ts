// Browser side of the passkey flows: fetch to /api/auth/* plus the two
// @simplewebauthn/browser ceremonies. All calls are same-origin, so the
// session cookie rides along and csrfOriginCheck sees Origin === ORIGIN.
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { describeApiError, isApiError, postJson, request } from "./api";

export type AuthUser = { id: string; displayName: string };

export type CredentialSummary = {
  id: string;
  deviceName: string | null;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
};

export const supportsPasskeys = (): boolean => browserSupportsWebAuthn();

export async function me(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AuthUser;
}

// Initial (token-gated) registration: begin -> browser ceremony -> verify.
export async function register(input: {
  displayName: string;
  initialRegistrationToken: string;
  deviceName?: string;
}): Promise<AuthUser> {
  const { options } = await postJson<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    "/api/auth/register/begin",
    { displayName: input.displayName, initialRegistrationToken: input.initialRegistrationToken },
  );
  const response = await startRegistration({ optionsJSON: options });
  return postJson<AuthUser>("/api/auth/register/verify", {
    response,
    ...(input.deviceName ? { deviceName: input.deviceName } : {}),
  });
}

export async function login(): Promise<AuthUser> {
  const { options } = await postJson<{ options: PublicKeyCredentialRequestOptionsJSON }>(
    "/api/auth/login/begin",
  );
  const response = await startAuthentication({ optionsJSON: options });
  return postJson<AuthUser>("/api/auth/login/verify", { response });
}

export const logout = (): Promise<Record<string, never>> => postJson("/api/auth/logout");

export const listCredentials = (): Promise<CredentialSummary[]> =>
  request("/api/auth/credentials");

export async function addDevice(deviceName: string): Promise<{ id: string }> {
  const { options } = await postJson<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    "/api/auth/credentials/add/begin",
  );
  const response = await startRegistration({ optionsJSON: options });
  return postJson<{ id: string }>("/api/auth/credentials/add/verify", {
    response,
    ...(deviceName ? { deviceName } : {}),
  });
}

export const removeCredential = (id: string): Promise<Record<string, never>> =>
  request(`/api/auth/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Map ceremony/API failures to a human sentence (UI shows `type`-agnostic text). */
export function describeAuthError(e: unknown): string {
  if (e instanceof WebAuthnError) {
    switch (e.code) {
      case "ERROR_CEREMONY_ABORTED":
        return "キャンセルまたはタイムアウトしました。もう一度どうぞ。";
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "この端末のパスキーは登録済みです。ログインしてください。";
      case "ERROR_INVALID_RP_ID":
        return "サーバの RP_ID がこのサイトのホスト名と一致していません。";
      case "ERROR_INVALID_DOMAIN":
        return "パスキーには HTTPS（または localhost）が必要です。";
      default:
        return `${e.code}: ${e.message}`;
    }
  }
  if (isApiError(e)) {
    // Auth-specific readings first; everything else (rate_limited,
    // session_expired, ...) shares the generic sentences in api.ts.
    switch (e.type) {
      case "registration_closed":
        return "登録は閉じられています（登録トークンが違うか、未設定です）。";
      case "auth_not_configured":
        return "サーバの認証設定が未完了です（SESSION_SECRET 未設定）。";
      case "not_found":
        return "この端末のパスキーは登録されていません。";
      case "challenge_mismatch":
        return "検証に失敗しました。最初からやり直してください。";
      case "last_credential":
        return "最後の 1 本のパスキーは削除できません。";
    }
  }
  return describeApiError(e);
}
