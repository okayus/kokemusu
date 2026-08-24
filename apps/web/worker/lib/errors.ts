import type { Context } from "hono";
import type { Env } from "../types";

// The whole API speaks one error grammar: `{ error: { type, message? } }` with
// the status derived from the type. `message` is for humans/logs; the SPA
// switches on `type` only.
const STATUS = {
  validation_error: 400,
  challenge_mismatch: 400,
  last_credential: 400,
  unauthorized: 401,
  session_expired: 401,
  registration_closed: 403,
  csrf_origin_mismatch: 403,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
  auth_not_configured: 503,
} as const;

export type ErrorType = keyof typeof STATUS;

export function fail(c: Context<Env>, type: ErrorType, message?: string) {
  return c.json(
    { error: { type, ...(message === undefined ? {} : { message }) } },
    STATUS[type],
  );
}
