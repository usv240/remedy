import { connection } from "next/server";
import { sandboxBuyerLogin } from "@/lib/sandbox-login";

/** The sandbox buyer login, shown where a visitor needs it: next to the sample shop's PayPal button and on the five-minute path. */
export async function SandboxLogin({ compact }: { compact?: boolean }) {
  await connection();
  const login = await sandboxBuyerLogin();
  if (!login) {
    return (
      <p className="sbl-missing">The PayPal sandbox buyer login is listed in the project&rsquo;s TESTING.md, under PayPal sandbox buyer login.</p>
    );
  }
  return (
    <dl className="sbl" data-compact={compact ? "" : undefined}>
      <div>
        <dt>Sandbox email</dt>
        <dd>
          <code>{login.email}</code>
        </dd>
      </div>
      <div>
        <dt>Password</dt>
        <dd>
          <code>{login.password}</code>
        </dd>
      </div>
    </dl>
  );
}
