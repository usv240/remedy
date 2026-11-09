import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The PayPal sandbox buyer login that TESTING.md publishes for testers, read from that file so the page and the file can
 * never disagree. It is a sandbox test account: it works only in PayPal's sandbox checkout window and moves no money.
 * Returns null when the file or its rows are missing.
 *
 * TESTING.md ships with the build, so it is read synchronously: an async file read during prerendering counts as
 * runtime data, and /try (which shows this account, masked) then fails to build when SANDBOX_BUYER_EMAIL is unset.
 */
export async function sandboxBuyerLogin(): Promise<{ email: string; password: string } | null> {
  try {
    const md = readFileSync(path.join(process.cwd(), "TESTING.md"), "utf8");
    const row = (label: string) => new RegExp(`^\\|\\s*${label}\\s*\\|\\s*\`([^\`]+)\`\\s*\\|`, "m").exec(md)?.[1] ?? null;
    const email = row("Email");
    const password = row("Password");
    return email && password ? { email, password } : null;
  } catch {
    return null;
  }
}
