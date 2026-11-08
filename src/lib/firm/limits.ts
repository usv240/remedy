/**
 * Claim limits, in plain code: one person, one refund per recall, and a ceiling on what the auto rule pays in a day.
 * Pure, so the firm console, /evidence and the payment step all read the same rules and the tests can pin them.
 *
 * One person is known by every identity a claim carries, not by one email: the payee (the PayPal email or phone the
 * refund goes to), the linked PayPal purchase and the PayPal account that paid for it, and a keyed hash of the network
 * address and browser the photo came from. A second claim on the same recall that shares any one of them goes to a
 * person at the firm, so a new email address alone does not start a new limit. Only hashes are compared; no address,
 * browser or email is stored in the clear.
 */
import { createHmac } from "node:crypto";
import { usd } from "@/lib/payments/deps";

export type Identity = "payee" | "purchase" | "payer" | "device";

/** Earlier claims on the same recall that share each identity with this one (sample and test claims are not counted). */
export type IdentityMatches = Record<Identity, number>;

export const IDENTITY_WORDS: Record<Identity, string> = {
  payee: "the email or phone the refund goes to",
  purchase: "the same PayPal purchase",
  payer: "the PayPal account that paid for the purchase",
  device: "the same network and browser",
};

export type LimitVerdict = { over: boolean; matched: Identity[]; plain: string; technical: string };

/** Whether this claim is a second claim by one person on one recall, and in which identities it matched. */
export function limitVerdict(m: IdentityMatches, firmName = "the firm"): LimitVerdict {
  const matched = (Object.keys(IDENTITY_WORDS) as Identity[]).filter((k) => m[k] > 0);
  if (!matched.length) return { over: false, matched, plain: "", technical: "No earlier claim on this recall shares a payee, purchase, payer or device." };
  const words = matched.map((k) => IDENTITY_WORDS[k]);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return {
    over: true,
    matched,
    plain: `An earlier claim on this recall shares ${list}, so a person at ${firmName} will check this one.`,
    technical: `Claim limit: earlier claims on this recall matched by ${matched.map((k) => `${k} (${m[k]})`).join(", ")}.`,
  };
}

/** What the auto rule may still pay today: past the firm's daily ceiling, a verified claim waits for a person. */
export function autoPayVerdict(a: { amountCents: number; paidTodayCents: number; capCents: number }): { ok: boolean; plain: string; technical: string } {
  const after = a.paidTodayCents + a.amountCents;
  if (after <= a.capCents) return { ok: true, plain: "", technical: `Auto-paid today ${usd(a.paidTodayCents)} + ${usd(a.amountCents)} is within the ${usd(a.capCents)} daily limit.` };
  return {
    ok: false,
    plain: `The firm's auto-pay limit of ${usd(a.capCents)} a day is reached, so a person approves this one.`,
    technical: `Auto-paid today ${usd(a.paidTodayCents)} + ${usd(a.amountCents)} is over the ${usd(a.capCents)} daily limit: sent for a reviewer's approval.`,
  };
}

/** The rules as the firm console and /evidence state them, from the firm's own settings. */
export function limitRules(t: { autoCapCents: number; autoDailyCents: number }): { title: string; rule: string }[] {
  return [
    { title: "One refund per person per recall", rule: "A second claim on the same recall that shares the payee, the PayPal purchase, the PayPal account that paid for it, or the network and browser goes to a person at the firm. A new email address alone does not reset it." },
    { title: "Paid with no person, up to a limit", rule: `A verified claim at or under ${usd(t.autoCapCents)} is paid by the auto rule, up to ${usd(t.autoDailyCents)} a day for each recall. Past that, verified claims wait in Needs review for a person to approve.` },
    { title: "Only hashes are compared", rule: "Each identity is kept as a keyed hash, never in the clear, and no firm sees another firm's claimants." },
  ];
}

/**
 * The hashed network and device signal for a claim: an HMAC of the caller's address and browser, keyed with the
 * server secret. Null when there is nothing to hash.
 */
export function visitorHash(ip: string | null | undefined, userAgent: string | null | undefined, secret = process.env.AUDIT_SALT || process.env.CHECKS_SECRET || "remedy"): string | null {
  const a = (ip ?? "").trim();
  const b = (userAgent ?? "").trim().slice(0, 300);
  if (!a && !b) return null;
  return createHmac("sha256", secret).update(`claim-visitor|${a}|${b}`).digest("hex").slice(0, 40);
}
