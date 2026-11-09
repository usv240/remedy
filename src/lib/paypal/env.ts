/**
 * Which PayPal Remedy talks to: PAYPAL_ENV, "sandbox" unless it says "live". Every PayPal address the code calls (the
 * REST API, the JavaScript SDK the sample shop loads, PayPal's MCP server) and the Server SDK's environment are read
 * from here, so going live changes PAYPAL_ENV, the client ID and the secret. Any other value stays on the sandbox, so
 * a typo never moves real money. No imports: the sample shop's page reads it on the server and hands the browser the
 * script address.
 */
export type PayPalEnv = "sandbox" | "live";

export const PAYPAL_HOSTS = {
  sandbox: { api: "https://api-m.sandbox.paypal.com", web: "https://www.sandbox.paypal.com", mcp: "https://mcp.sandbox.paypal.com" },
  live: { api: "https://api-m.paypal.com", web: "https://www.paypal.com", mcp: "https://mcp.paypal.com" },
} as const;

export function paypalEnv(value: string | undefined = process.env.PAYPAL_ENV): PayPalEnv {
  return value?.trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/** The REST API every raw call and the OAuth token request use. */
export const paypalApiBase = (env: PayPalEnv = paypalEnv()) => PAYPAL_HOSTS[env].api;
/** The JavaScript SDK v6 script the sample shop's PayPal button loads. */
export const paypalJsSdkSrc = (env: PayPalEnv = paypalEnv()) => `${PAYPAL_HOSTS[env].web}/web-sdk/v6/core`;
/** PayPal's hosted MCP server, read only (check C6); PAYPAL_MCP_URL can still name another one. */
export const paypalMcpDefault = (env: PayPalEnv = paypalEnv()) => PAYPAL_HOSTS[env].mcp;
/** The word the status pages use for the account in use. */
export const paypalEnvWord = (env: PayPalEnv = paypalEnv()) => (env === "live" ? "Live" : "Sandbox");

/**
 * What going live changes, as /stack states it; .env.example and render.yaml set PAYPAL_ENV up the same way, and
 * tests/paypal-env.test.ts holds the sentence to the code.
 */
export const GOING_LIVE =
  "Going live sets PAYPAL_ENV=live, which moves every PayPal address (the REST API, the Server SDK, the JavaScript SDK and PayPal's MCP server) to PayPal's live ones, and swaps in a live app's client ID, secret and webhook ID.";
