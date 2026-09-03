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

// Same fail-closed gate for PAT_PEPPER. Unset means: minting answers 503 and
// Bearer validation matches nothing — deliberately NOT the skill's lenient
// `?? ""`, which lets a token minted before the secret exists die silently the
// moment the pepper is set. Here that trap cannot happen: no pepper, no token.
export function getPatPepper(env: Bindings): string | null {
  const pepper = env.PAT_PEPPER;
  if (!pepper) return null;
  if (pepper.length < MIN_SECRET_LENGTH) {
    console.error("PAT_PEPPER is shorter than 32 chars; treating it as unset");
    return null;
  }
  return pepper;
}
