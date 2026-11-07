import { closestMatch, DUPLICATE_MAX_DISTANCE, nearestDistances, type HashMatch } from "./dhash";
import { inRange, knownModels, knownRanges, matchModel, parseUnits } from "./identifiers";
import type { VisionReport } from "./vision-schema";
import type { Amount, CheckId, CheckResult, CheckStatus, ClaimContext, HashRef, Money, ProofAction, VerifyProofRule, VerifyRecall } from "./types";

/**
 * C1 to C6 as pure functions (C6 awaits the payments builder's lookup). Each returns a plain reason for the owner and
 * a technical reason for the firm and developers. Vision findings come in as data; the pass conditions are here.
 */

export const CHECK_NAMES: Record<CheckId, string> = {
  C1: "Right product",
  C2: "Made safe",
  C3: "Your own photo",
  C4: "Within the recall",
  C5: "Claim limits",
  C6: "Not already refunded",
};

export const LIMITS = {
  /** C1 passes at or above this (plan 7.2). */
  productPass: 0.85,
  /** Below this C1 fails outright; between the two it is unclear and goes to the Two reviewers. */
  productFloor: 0.5,
  /** A made-safe action counts when the model is at least this sure it is done. */
  actionConfidence: 0.7,
  /** Screen or printout: fail at or above, unclear from `screenUnclear`. */
  screenFail: 0.7,
  screenUnclear: 0.4,
  /** A downloaded or catalog image: fail at or above, unclear from `digitalUnclear`. */
  digitalFail: 0.85,
  digitalUnclear: 0.6,
} as const;

export const VISION_UNAVAILABLE = "Vision check unavailable; a person at the firm will look.";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function result(id: CheckId, status: CheckStatus, plain: string, technical: string, extra: Partial<Pick<CheckResult, "score" | "evidence">> = {}): CheckResult {
  return { id, name: CHECK_NAMES[id], pass: status === "pass", status, reason_plain: plain, reason_technical: technical, ...extra };
}

export function unavailable(id: CheckId, technical: string): CheckResult {
  return result(id, "unavailable", VISION_UNAVAILABLE, technical);
}

export function skipped(id: CheckId, why: string): CheckResult {
  return result(id, "skipped", "Not checked yet.", why);
}

// C1 ---------------------------------------------------------------------------------------------

export function evaluateC1(v: VisionReport): CheckResult {
  const score = r2(clamp01(v.product.match_score));
  const status: CheckStatus = score >= LIMITS.productPass ? "pass" : score >= LIMITS.productFloor ? "unclear" : "fail";
  const plain =
    status === "pass" ? "This looks like the recalled product." : status === "unclear" ? "We could not confirm this is the exact recalled product." : "This does not look like the recalled product.";
  return result("C1", status, plain, `Claude vision match score ${score} (pass at ${LIMITS.productPass}, unclear from ${LIMITS.productFloor}). ${v.product.reason_technical}`.trim(), {
    score,
    evidence: { matching: v.product.matching_details, differing: v.product.differing_details, model_reason: v.product.reason_plain },
  });
}

// C2 ---------------------------------------------------------------------------------------------

const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** The marker word, read exactly but ignoring case and surrounding punctuation, as a whole word or phrase. */
export function markerMatches(text: string, marker: string): boolean {
  const t = words(text);
  const m = words(marker);
  if (!m) return false;
  return t === m || ` ${t} `.includes(` ${m} `);
}

export type ActionFinding = { action: ProofAction; done: boolean; confidence?: number; evidence: string; problem?: "missing" | "not_on_product" | "misspelled" | "not_visible" };

export function markerOf(rule: VerifyProofRule): string {
  return rule.marker_text?.trim() || "RECALLED";
}

export function evaluateC2(v: VisionReport, rule: VerifyProofRule): CheckResult & { findings: ActionFinding[] } {
  const required = [...new Set(rule.actions)];
  if (required.length === 0) {
    return { ...result("C2", "pass", "This recall does not ask for a change to the product.", "The proof rule lists no actions."), findings: [] };
  }
  const marker = markerOf(rule);
  const findings: ActionFinding[] = required.map((action) => {
    if (action === "write_recalled") {
      const onProduct = v.handwritten_text.filter((h) => h.on_product);
      const hit = onProduct.find((h) => markerMatches(h.text, marker));
      if (hit) return { action, done: true, evidence: `Read "${hit.text}" ${hit.where}`.trim() };
      const offProduct = v.handwritten_text.find((h) => !h.on_product && markerMatches(h.text, marker));
      if (offProduct) return { action, done: false, evidence: `Read "${offProduct.text}" ${offProduct.where}, not on the product`, problem: "not_on_product" };
      const near = onProduct[0];
      if (near) return { action, done: false, evidence: `Read "${near.text}" ${near.where}; needs "${marker}"`, problem: "misspelled" };
      return { action, done: false, evidence: "No handwriting found on the product.", problem: "missing" };
    }
    const seen = v.actions.find((a) => a.action === action);
    if (!seen) return { action, done: false, evidence: "Not reported.", problem: "not_visible" };
    const confidence = r2(clamp01(seen.confidence));
    const done = seen.done && confidence >= LIMITS.actionConfidence;
    return { action, done, confidence, evidence: seen.evidence, problem: done ? undefined : "not_visible" };
  });
  const ok = findings.every((f) => f.done);
  const plain = ok ? "The photo shows the product made safe." : "The photo does not show the product made safe yet.";
  const technical = findings.map((f) => `${f.action}: ${f.done ? "confirmed" : `not confirmed (${f.problem})`}${f.confidence !== undefined ? `, confidence ${f.confidence}` : ""}. ${f.evidence}`).join(" ");
  return { ...result("C2", ok ? "pass" : "fail", plain, technical, { evidence: { findings, marker } }), findings };
}

// C3 ---------------------------------------------------------------------------------------------

export type OwnPhotoKind = "official" | "earlier_claim" | "screen" | "digital" | null;

/** Signs the model can list for a photo of a screen, and for a photo of a printout. */
const SCREEN_SIGNS = ["moire", "screen_bezel", "screen_glare", "pixel_grid", "app_or_web_ui"] as const;
const PRINT_SIGNS = ["paper_texture", "halftone_dots", "paper_edge"] as const;
/** This many of one kind's signs on a photo the model calls a camera photo: code does not take it as the owner's own. */
export const CONTRADICTING_SIGNS = 2;

/**
 * The hash half of C3, with no model call: matches against the claimed recall's own official images and its earlier
 * claim photos only. The screen-or-printout reading in the vision call is the main own-photo signal.
 */
export function hashMatches(variants: string[], officialHashes: readonly HashRef[], priorHashes: readonly HashRef[]) {
  return {
    official: closestMatch(variants, officialHashes),
    prior: closestMatch(variants, priorHashes),
    nearest: {
      official: nearestDistances(variants, officialHashes)[0] ?? null,
      prior: nearestDistances(variants, priorHashes)[0] ?? null,
    },
  };
}

export function evaluateC3(args: {
  dhash: string;
  official: HashMatch | null;
  prior: HashMatch | null;
  nearest: { official: { ref: string; distance: number } | null; prior: { ref: string; distance: number } | null };
  source: VisionReport["photo_source"] | null;
  exif: boolean;
  visionAvailable: boolean;
}): { check: CheckResult; kind: OwnPhotoKind } {
  const evidence = { dhash: args.dhash, nearest: args.nearest, exif_present: args.exif, photo_source: args.source ?? null };
  const hashNote = `dHash ${args.dhash}; nearest official ${args.nearest.official ? `${args.nearest.official.distance} bits` : "none"}, nearest earlier claim ${args.nearest.prior ? `${args.nearest.prior.distance} bits` : "none"} (reused at ${DUPLICATE_MAX_DISTANCE} or less).`;
  if (args.official) {
    // CPSC sometimes publishes an example of the made-safe photo with the recall; name it kindly as that example.
    const example = /example|cut|disposal|destroy|unusable|marked|written/i.test(args.official.caption ?? "");
    const plain = example
      ? "This is the example photo from the recall notice. Please send a photo of your own product."
      : "This is the official recall picture. Please send a photo of your own product.";
    return {
      kind: "official",
      check: result("C3", "fail", plain, `Matches this recall's official image ${args.official.ref}${args.official.caption ? ` ("${args.official.caption}")` : ""} at ${args.official.distance} bits (${args.official.orientation}). ${hashNote}`, {
        evidence: { ...evidence, matched: args.official },
      }),
    };
  }
  if (args.prior) {
    return {
      kind: "earlier_claim",
      check: result("C3", "fail", "This photo matches one sent with an earlier claim, so a person at the firm will take a look.", `Matches earlier claim photo ${args.prior.ref} at ${args.prior.distance} bits (${args.prior.orientation}). ${hashNote}`, { evidence }),
    };
  }
  if (!args.visionAvailable || !args.source) {
    return { kind: null, check: result("C3", "unavailable", VISION_UNAVAILABLE, `Unique by hash. Screen and printout check needs vision. ${hashNote}`, { evidence }) };
  }
  const conf = r2(clamp01(args.source.confidence));
  const signs = args.source.signs.filter((s) => s !== "none").join(", ") || "none";
  const tech = `Claude: ${args.source.kind} (confidence ${conf}; signs: ${signs}). ${args.source.reason} ${hashNote}`.replace(/\s+/g, " ").trim();
  const screenLike = args.source.kind === "photo_of_screen" || args.source.kind === "photo_of_printout";
  if (screenLike && conf >= LIMITS.screenFail) {
    const what = args.source.kind === "photo_of_screen" ? "a screen" : "a printout";
    return { kind: "screen", check: result("C3", "fail", `This looks like a photo of ${what}. Please take a photo of the product itself.`, tech, { evidence, score: conf }) };
  }
  if (args.source.kind === "digital_image" && conf >= LIMITS.digitalFail) {
    return { kind: "digital", check: result("C3", "fail", "This looks like a picture from the web. Please take a photo of your own product.", tech, { evidence, score: conf }) };
  }
  if ((screenLike && conf >= LIMITS.screenUnclear) || (args.source.kind === "digital_image" && conf >= LIMITS.digitalUnclear)) {
    return { kind: null, check: result("C3", "unclear", "We could not confirm this photo was taken by you.", tech, { evidence, score: conf }) };
  }
  // The model's own signs can disagree with its label. Two or more screen signs (or printout signs) on a photo it calls a
  // camera photo are not taken as the owner's own photo: a person looks instead. A photo of a monitor read on 2026-11-06
  // as camera_photo 0.75 with screen_bezel, screen_glare and app_or_web_ui is the case this closes.
  const screenSigns = args.source.signs.filter((s) => (SCREEN_SIGNS as readonly string[]).includes(s)).length;
  const printSigns = args.source.signs.filter((s) => (PRINT_SIGNS as readonly string[]).includes(s)).length;
  if (!screenLike && args.source.kind !== "digital_image" && (screenSigns >= CONTRADICTING_SIGNS || printSigns >= CONTRADICTING_SIGNS)) {
    const what = screenSigns >= CONTRADICTING_SIGNS ? `${screenSigns} screen signs` : `${printSigns} printout signs`;
    return { kind: null, check: result("C3", "unclear", "We could not confirm this photo was taken by you.", `${tech} Code: ${what} disagree with the label ${args.source.kind}, so the photo is not taken as the owner's own.`, { evidence, score: conf }) };
  }
  return { kind: null, check: result("C3", "pass", "This is a new photo of the product.", tech, { evidence, score: conf }) };
}

// C4 ---------------------------------------------------------------------------------------------

type Part = { status: CheckStatus; plain: string; technical: string };

export function evaluateC4(args: { rule: VerifyProofRule; recall: VerifyRecall; identifiers: VisionReport["identifiers"] | null }): CheckResult {
  const { rule, recall, identifiers } = args;
  const needModel = rule.must_show.includes("model_number");
  const needLot = rule.must_show.includes("serial_or_lot");
  const needDate = rule.must_show.includes("date_code");
  const models = knownModels(recall);
  const ranges = knownRanges(recall);
  const evidence = { required: { model: needModel, lot: needLot, date_code: needDate }, models, ranges, read: identifiers };
  if (!identifiers) {
    if (needModel || needLot || needDate) return { ...unavailable("C4", "The proof rule asks for an identifier; reading it needs vision."), evidence };
    return result("C4", "pass", "No model or lot number is needed for this recall.", "The proof rule asks for no model, lot or date code, and none was read.", { evidence });
  }
  const parts: Part[] = [];

  const model = identifiers.model_text?.trim() || null;
  if (model && models.length) {
    const hit = matchModel(model, models);
    parts.push(
      hit
        ? { status: "pass", plain: `Model ${model} is part of this recall.`, technical: `Model read "${model}" matches "${hit.model}"${hit.exact ? "" : " with a variant suffix"}.` }
        : { status: "fail", plain: `Model ${model} is not one of the recalled models.`, technical: `Model read "${model}"; recalled models: ${models.join(", ")}.` },
    );
  } else if (needModel) {
    parts.push(
      model
        ? { status: "pass", plain: `Model ${model} can be read.`, technical: `Model read "${model}"; the recall lists no model numbers to compare.` }
        : { status: "unclear", plain: "We could not read the model number.", technical: "The proof rule asks for the model number; none was readable." },
    );
  }

  const ranged = (read: string | null, kinds: string[], need: boolean, label: string) => {
    const rs = ranges.filter((r) => kinds.includes(r.kind));
    if (read && rs.length) {
      const results = rs.map((r) => inRange(read, r));
      if (results.some((x) => x === true)) parts.push({ status: "pass", plain: `The ${label} ${read} is inside the recall.`, technical: `${label} "${read}" is within ${rs.map((r) => `${r.from} to ${r.to}`).join(" or ")}.` });
      else if (results.every((x) => x === false)) parts.push({ status: "fail", plain: `The ${label} ${read} is outside the recall.`, technical: `${label} "${read}" is outside ${rs.map((r) => `${r.from} to ${r.to}`).join(" and ")}.` });
      else parts.push({ status: "unclear", plain: `We could not compare the ${label} with the recall.`, technical: `${label} "${read}" is not in a format comparable with ${rs.map((r) => `${r.from} to ${r.to}`).join(", ")}.` });
    } else if (need) {
      parts.push(
        read
          ? { status: "pass", plain: `The ${label} ${read} can be read.`, technical: `${label} read "${read}"; the recall gives no range to compare.` }
          : { status: "unclear", plain: `We could not read the ${label}.`, technical: `The proof rule asks for the ${label}; none was readable.` },
      );
    }
  };
  ranged(identifiers.date_code_text?.trim() || null, ["date_code"], needDate, "date code");
  ranged(identifiers.lot_text?.trim() || null, ["lot", "serial"], needLot, "lot number");

  if (parts.length === 0) return result("C4", "pass", "No model or lot number is needed for this recall.", "The proof rule asks for no model, lot or date code, and nothing read conflicts with the recall.", { evidence });
  const status: CheckStatus = parts.some((p) => p.status === "fail") ? "fail" : parts.some((p) => p.status === "unclear") ? "unclear" : "pass";
  const lead = parts.find((p) => p.status === status) ?? parts[0];
  return result("C4", status, lead.plain, parts.map((p) => p.technical).join(" "), { evidence });
}

// C5 ---------------------------------------------------------------------------------------------

export function evaluateC5(ctx: ClaimContext, recall: VerifyRecall): CheckResult {
  const units = Math.max(1, Math.floor(ctx.unitsPurchased ?? 1));
  const payeeClaim = Math.max(0, ctx.payeeClaimCount ?? 0) + 1;
  const recallUnits = ctx.recallUnits ?? parseUnits(recall.units ?? recall.products[0]?.units ?? null);
  const totalClaim = Math.max(0, ctx.recallClaimCount ?? 0) + 1;
  const evidence = { payee_claim: payeeClaim, units_purchased: units, recall_claim: totalClaim, recall_units: recallUnits };
  const technical = `Payee claim ${payeeClaim} of ${units} unit${units === 1 ? "" : "s"} purchased; recall claim ${totalClaim} of ${recallUnits ?? "unknown"} units.`;
  if (payeeClaim > units) {
    return result("C5", "fail", `This would be claim ${payeeClaim} for this payee, and the purchase covers ${units}. A person at the firm can approve more with a receipt.`, technical, { evidence });
  }
  if (recallUnits !== null && totalClaim > recallUnits) {
    return result("C5", "fail", "This recall has more claims than units sold, so a person at the firm will check each one. This keeps the refund pool for real owners.", technical, { evidence });
  }
  return result("C5", "pass", units > 1 ? `Claim ${payeeClaim} of ${units} for this purchase.` : "This claim is within the limit for one purchase.", technical, { evidence });
}

// C6 ---------------------------------------------------------------------------------------------

export async function evaluateC6(ctx: ClaimContext): Promise<CheckResult> {
  const cap = ctx.linkedCapture;
  if (!cap) return result("C6", "pass", "No PayPal purchase linked.", "No capture is linked, so there is no earlier PayPal refund or dispute to check.");
  if (!ctx.hasPriorRefund) {
    return result("C6", "unclear", "We could not check the linked PayPal purchase yet, so a person at the firm will look.", `Capture ${cap.id} is linked, but no refund lookup was supplied.`);
  }
  try {
    const r = await ctx.hasPriorRefund(cap.id);
    if (r.refunded) return result("C6", "fail", r.plain ?? "This PayPal purchase was already refunded.", r.technical ?? `Capture ${cap.id} has a refund.`, { evidence: { capture_id: cap.id } });
    if (r.disputed) return result("C6", "fail", r.plain ?? "This PayPal purchase has an open dispute, so a person at the firm will look.", r.technical ?? `Capture ${cap.id} has an open dispute.`, { evidence: { capture_id: cap.id } });
    return result("C6", "pass", r.plain ?? "No earlier refund or dispute on the PayPal purchase.", r.technical ?? `Capture ${cap.id}: no refund, no open dispute.`, { evidence: { capture_id: cap.id } });
  } catch (e) {
    return result("C6", "unclear", "We could not reach PayPal to check the purchase, so a person at the firm will look.", `Refund lookup for capture ${cap.id} failed: ${(e as Error).message}`, { evidence: { capture_id: cap.id } });
  }
}

// Money ------------------------------------------------------------------------------------------

/** Exact cents from a PayPal-style amount string; null for anything that is not a plain non-negative amount. */
export function toCents(m: Money | null | undefined): number | null {
  if (!m) return null;
  const s = String(m.value).trim();
  const x = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!x) return null;
  return Number(x[1]) * 100 + Number((x[2] ?? "").padEnd(2, "0"));
}

export const fromCents = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export type AmountResult = { amount: Amount | null; cap: Amount | null; overCap: boolean; missing: boolean; technical: string };

/**
 * The refund is the lower of the firm's amount and the linked PayPal capture, never more than the owner paid.
 * Over the auto-approve cap, or no amount when the firm has set a cap, goes to a person.
 */
export function computeAmount(ctx: ClaimContext): AmountResult {
  const firm = toCents(ctx.firmAmount);
  const capture = toCents(ctx.linkedCapture?.amount);
  const capCents = toCents(ctx.autoCap);
  const cur = (ctx.firmAmount?.currency ?? ctx.linkedCapture?.amount.currency ?? ctx.autoCap?.currency ?? "USD").toUpperCase();
  const options: Amount[] = [];
  if (firm !== null) options.push({ value: fromCents(firm), currency: cur, cents: firm, source: "firm" });
  if (capture !== null) {
    const cc = ctx.linkedCapture!.amount.currency.toUpperCase();
    if (cc === cur) options.push({ value: fromCents(capture), currency: cc, cents: capture, source: "capture" });
  }
  const amount = options.reduce<Amount | null>((a, b) => (!a || b.cents < a.cents ? b : a), null);
  const cap = capCents !== null ? { value: fromCents(capCents), currency: (ctx.autoCap!.currency || cur).toUpperCase(), cents: capCents, source: "firm" as const } : null;
  const missing = cap !== null && amount === null;
  const overCap = Boolean(cap && amount && (amount.cents > cap.cents || amount.currency !== cap.currency));
  const parts = [
    firm !== null ? `firm amount ${fromCents(firm)}` : "no firm amount",
    capture !== null ? `capture ${fromCents(capture)} ${ctx.linkedCapture!.amount.currency}` : "no linked capture",
    amount ? `refund ${amount.value} ${amount.currency} (${amount.source}, the lower)` : "no refund amount",
    cap ? `auto cap ${cap.value} ${cap.currency}${overCap ? ", over the cap" : ""}` : "no auto cap",
  ];
  return { amount, cap, overCap, missing, technical: `${parts.join("; ")}.` };
}
