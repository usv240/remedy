/**
 * The sample firm's terms for a recall: who pays, how much, and the cap under which a verified claim is paid with no
 * person. Every demo claim is paid by Brightline Home (fictional) from its PayPal sandbox account, whichever real
 * recall it is for, and says so; a claim on Fernway Home's sample recall (FW-2026-01) is paid by Fernway Home, the
 * second fictional sample firm.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, dbConfigured, schema } from "@/lib/db";
import { sampleFirmOf } from "@/lib/recall/label";

export const SAMPLE_FIRM = "Brightline Home";

/**
 * The recall the sample shop's product belongs to: Brightline Home's own fictional sample recall of its 65W laptop
 * charger (content/recalls/samples.json). "Bought it from Brightline with PayPal?" appears on it.
 */
export const SHOP_RECALL = "BH-2026-01";

/**
 * The refund the sample firm pays in this demonstration when it has set none for a recall (firm_recall.default_refund).
 * A setting, not a statistic: the real remedies say "a full refund" of what the owner paid, which Remedy cannot know.
 */
export const DEMO_REFUND_CENTS = 2000;

export type FirmTerms = {
  firmId: number | null;
  firmName: string;
  /**
   * The firm as an owner reads it on a claim: the sample firm by name on its own fictional sample recall, and "the
   * recalling firm" on a real CPSC recall, so a fictional firm is never named as the one that pays or reviews it.
   */
  ownerName: string;
  /** Verified claims at or under this are paid with no person. */
  autoCapCents: number;
  /** What the auto rule pays on this recall in a UTC day at most (firm_recall.daily_cap); past it, a person approves. */
  autoDailyCents: number;
  /** The firm's refund for this recall when no PayPal purchase is linked. */
  refundCents: number;
  refundSource: "firm" | "demo";
  /** How long the firm takes to look at a claim, for the owner's "usually within" line. */
  reviewHours: number;
  /** The firm runs this recall in Remedy (a firm_recall row), or it is a demo of a recall it does not run. */
  runsRecall: boolean;
};

const cents = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const DEFAULT_TERMS: FirmTerms = { firmId: null, firmName: SAMPLE_FIRM, ownerName: "the recalling firm", autoCapCents: 5000, autoDailyCents: 35_000, refundCents: DEMO_REFUND_CENTS, refundSource: "demo", reviewHours: 48, runsRecall: false };

export async function firmTerms(recallNumber: string): Promise<FirmTerms> {
  // Without a database, a sample recall is still named for the firm that runs it.
  const ownerName = sampleFirmOf(recallNumber) ?? "the recalling firm";
  const fallback: FirmTerms = { ...DEFAULT_TERMS, firmName: sampleFirmOf(recallNumber) ?? DEFAULT_TERMS.firmName, ownerName };
  if (!dbConfigured()) return fallback;
  try {
    // The sample firm that runs this recall (Fernway Home runs FW-2026-01); any other recall falls to the first sample
    // firm, Brightline Home, as before.
    const [runs] = await db()
      .select({ firm: schema.firms, fr: schema.firmRecalls })
      .from(schema.firmRecalls)
      .innerJoin(schema.firms, eq(schema.firms.id, schema.firmRecalls.firmId))
      .where(and(eq(schema.firms.isSample, true), eq(schema.firmRecalls.recallNumber, recallNumber)))
      .orderBy(asc(schema.firms.id))
      .limit(1);
    const firm = runs?.firm ?? (await db().select().from(schema.firms).where(eq(schema.firms.isSample, true)).orderBy(asc(schema.firms.id)).limit(1))[0];
    if (!firm) return fallback;
    const settings = firm.settings ?? {};
    const fr = runs?.fr;
    const refund = cents(fr?.defaultRefund);
    return {
      firmId: firm.id,
      firmName: firm.name.replace(/\s*\(sample\)\s*$/i, "") || SAMPLE_FIRM,
      ownerName,
      autoCapCents: cents(fr?.autoCap) ?? cents(settings.autoApproveCap) ?? DEFAULT_TERMS.autoCapCents,
      autoDailyCents: cents(fr?.dailyCap) ?? cents(settings.dailyPayoutCap) ?? DEFAULT_TERMS.autoDailyCents,
      refundCents: refund ?? DEMO_REFUND_CENTS,
      refundSource: refund !== null ? "firm" : "demo",
      reviewHours: settings.reviewHours ?? DEFAULT_TERMS.reviewHours,
      runsRecall: Boolean(fr),
    };
  } catch {
    return fallback;
  }
}

/** "usually within 2 days" from the firm's review hours. */
export function reviewWindow(hours: number): string {
  if (hours <= 24) return `usually within ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `usually within ${days} ${days === 1 ? "day" : "days"}`;
}
