import type { CDPSession, Page } from "@playwright/test";

// Chromium's virtual authenticator over CDP (skill cloudflare-workers-e2e-playwright).
// The real @simplewebauthn/browser → @simplewebauthn/server ceremony runs end to
// end — no DEV_BYPASS_USER_ID, which would skip exactly the wiring the golden
// path exists to protect. Attach it BEFORE the page calls
// navigator.credentials.create / get. Each test gets a fresh browser context,
// hence a fresh authenticator: credentials never leak between tests.
export type VirtualAuthenticator = { cdp: CDPSession; authenticatorId: string };

export async function enableVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      // A platform authenticator (Touch ID-like), which is what a passkey is.
      transport: "internal",
      // residentKey: "required" server-side = discoverable credential = username-less login.
      hasResidentKey: true,
      hasUserVerification: true,
      // "the biometric prompt passed" — the server asks for userVerification: "preferred".
      isUserVerified: true,
    },
  });
  return { cdp, authenticatorId };
}
