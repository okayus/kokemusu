import type { Bindings } from "../types";

// Fail-closed gate for SESSION_SECRET. The length floor rejects a weak value
// (someone setting SESSION_SECRET=dev) the same way as an unset one — HS256
// with a guessable key would make every session and challenge forgeable.
// `openssl rand -hex 32` produces 64 chars, comfortably above the floor.
const MIN_SECRET_LENGTH = 32;

export function getSessionSecret(env: Bindings): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error("SESSION_SECRET is shorter than 32 chars; treating it as unset");
    return null;
  }
  return secret;
}
