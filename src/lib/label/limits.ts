/**
 * How many live label readings one visitor or one API key may ask for: each is one Claude call. The sample labels
 * replay their recorded reading and count against nothing. On top of the API's own per-minute limit (guard), and the
 * site's daily AI budget (src/lib/ai/usage.ts) is checked before every live call. Server only.
 */
import { clientKey, hit } from "@/lib/ratelimit";

export const LABEL_LIMITS = { perWindow: 6, windowMs: 10 * 60_000, perDay: 20, keyPerDay: 25, dayMs: 24 * 60 * 60_000 } as const;

export type LabelAllowance = { ok: true } | { ok: false; retryAfterSec: number; plain: string };

/** Count one live reading for this key, or else this visitor, or say when to try again. */
export async function allowLabelRead(o: { ip?: string | null; keyId?: number | null }, now = Date.now()): Promise<LabelAllowance> {
  if (o.keyId) {
    const day = await hit(`label-key-day:${o.keyId}`, LABEL_LIMITS.keyPerDay, LABEL_LIMITS.dayMs, now);
    return day.ok ? { ok: true } : { ok: false, retryAfterSec: day.retryAfterSec, plain: `This key has read ${LABEL_LIMITS.keyPerDay} labels today. The limit resets over the next 24 hours; the sample labels still answer.` };
  }
  const key = clientKey(o.ip ?? "local");
  const day = await hit(`label-day:${key}`, LABEL_LIMITS.perDay, LABEL_LIMITS.dayMs, now);
  if (!day.ok) return { ok: false, retryAfterSec: day.retryAfterSec, plain: "You have checked a lot of labels today. Please come back tomorrow, search by name, or try a sample label." };
  const short = await hit(`label:${key}`, LABEL_LIMITS.perWindow, LABEL_LIMITS.windowMs, now);
  if (!short.ok) return { ok: false, retryAfterSec: short.retryAfterSec, plain: "That is a lot of labels in a few minutes. Please wait a little, search by name, or try a sample label." };
  return { ok: true };
}
