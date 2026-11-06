import { connection } from "next/server";
import { sandboxBuyerLogin } from "@/lib/sandbox-login";

/** The sandbox buyer login, shown where a judge needs it: next to the sample shop's PayPal button and on the judges' path. */
export async function SandboxLogin({ compact }: { compact?: boolean }) {
  await connection();
  const login = await sandboxBuyerLogin();
  if (!login) {
    return (
      <p className="sbl-missing">
        Use the PayPal sandbox buyer login in the project&rsquo;s{" "}
        <a className="text-link" href="https://github.com/usv240/remedy/blob/main/TESTING.md#paypal-sandbox-buyer-login">
          TESTING.md
        </a>
        .
      </p>
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
