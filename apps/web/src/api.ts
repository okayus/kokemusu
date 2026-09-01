// Shared fetch layer for /api/*. The whole API speaks one error grammar —
// `{ error: { type, message? } }` (worker/lib/errors.ts) — so every client
// module throws the same shape and the UI switches on `type` only.

export type ApiError = Error & { status: number; type?: string };

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as { status?: unknown }).status === "number";
}

type ApiErrorShape = { error?: { type?: string; message?: string } };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorShape;
    throw Object.assign(new Error(body.error?.message ?? `HTTP ${res.status}`), {
      status: res.status,
      type: body.error?.type,
    });
  }
  return (await res.json()) as T;
}

export const postJson = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

/** Human sentence for the generic API error types (auth-specific ones live in auth-api). */
export function describeApiError(e: unknown): string {
  if (isApiError(e)) {
    switch (e.type) {
      case "validation_error":
        return "入力が受け付けられませんでした。長さやタグを見直してください。";
      case "unauthorized":
      case "session_expired":
        return "セッションが切れました。もう一度ログインしてください。";
      case "rate_limited":
        return "試行が多すぎます。1 分ほど待ってください。";
      case "encryption_not_configured":
        return "サーバの暗号化設定が未完了です（BODY_KEY 未設定）。";
      case "csrf_origin_mismatch":
        return "別のオリジンからのリクエストは受け付けません。";
      default:
        return `${e.message}（HTTP ${e.status}）`;
    }
  }
  return String(e);
}
