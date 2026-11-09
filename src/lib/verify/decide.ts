import { markerOf, type ActionFinding, type AmountResult, type OwnPhotoKind } from "./checks";
import { qualityGuidance } from "./quality";
import type { CheckId, Checks, Decision, Guidance, QualityReport, VerifyProofRule, VerifyRecall } from "./types";

/**
 * The decision (docs/how-it-works.md, "How it works"), in plain code:
 *  - verified: C1 to C6 pass and the amount is at or under the firm's auto-approve cap;
 *  - retake: C2 fails or the photo quality is low, with guidance naming what to change. A photo that is not the
 *    owner's own (the official image, a screen, a printout, a web picture) also gets a retake asking for their own
 *    photo, as acceptance test 2 expects;
 *  - firm_review: anything in between, the Two reviewers disagree, or the amount is over the cap.
 * A photo where the vision report sees a person (a face, a body or a child) is a retake before anything else: the
 * owner is asked for a photo of the product alone, and the claim code deletes the stored photo at once.
 * When the only open items are judgement calls (C1, C3 or C4 unclear), two independent reviewers look; if both
 * cite visible evidence and agree it meets the recall, the claim is verified. Anything else goes to a person.
 */

export type Blocker = { id: CheckId | "amount"; soft: boolean; why: string };

export type DecidedBy = "own_photo" | "quality" | "made_safe" | "checks" | "reviewers" | "unreadable" | "person";

/** Every reason the claim is not verified on the checks alone. Soft ones are judgement calls the reviewers may settle. */
export function blockersOf(checks: Checks, amount: AmountResult): Blocker[] {
  const out: Blocker[] = [];
  for (const c of Object.values(checks)) {
    if (c.pass) continue;
    const soft = c.status === "unclear" && (c.id === "C1" || c.id === "C3" || c.id === "C4");
    out.push({ id: c.id, soft, why: `${c.id} ${c.status}` });
  }
  if (amount.overCap) out.push({ id: "amount", soft: false, why: `amount ${amount.amount?.value} over auto cap ${amount.cap?.value}` });
  if (amount.missing) out.push({ id: "amount", soft: false, why: "no refund amount set" });
  return out;
}

export type ReviewVerdict = { decision: "verify" | "person"; agreed: boolean } | null;

export function decide(args: { quality: QualityReport; checks: Checks; ownPhoto: OwnPhotoKind; amount: AmountResult; review?: ReviewVerdict; personVisible?: boolean }): {
  decision: Decision;
  decided_by: DecidedBy;
  blockers: Blocker[];
} {
  const blockers = blockersOf(args.checks, args.amount);
  if (args.personVisible) return { decision: "retake", decided_by: "person", blockers };
  if (args.ownPhoto === "official" || args.ownPhoto === "screen" || args.ownPhoto === "digital") return { decision: "retake", decided_by: "own_photo", blockers };
  if (!args.quality.ok) return { decision: "retake", decided_by: "quality", blockers };
  if (args.checks.C2.status === "fail") return { decision: "retake", decided_by: "made_safe", blockers };
  if (blockers.length === 0) return { decision: "verified", decided_by: "checks", blockers };
  if (args.review?.decision === "verify" && args.review.agreed && blockers.every((b) => b.soft)) return { decision: "verified", decided_by: "reviewers", blockers };
  return { decision: "firm_review", decided_by: args.review ? "reviewers" : "checks", blockers };
}

/** Reviewers run for firm-review cases where vision worked; they can only lift soft blockers, but their evidence helps the person either way. */
export function shouldReview(checks: Checks, blockers: Blocker[]): boolean {
  const visionRan = (["C1", "C2"] as const).every((id) => checks[id].status !== "unavailable" && checks[id].status !== "skipped");
  return visionRan && blockers.length > 0;
}

const OWN_PHOTO_STEPS = [
  "Take a new photo of the product with your phone camera.",
  "Show the product itself, not a screen, a printout or the recall picture.",
  "We ask for your own photo so the refund goes to the person who has the product.",
];

function actionStep(f: ActionFinding, rule: VerifyProofRule): string {
  const marker = markerOf(rule).toUpperCase();
  switch (f.action) {
    case "write_recalled":
      if (f.problem === "not_on_product") return `Write ${marker} on the product itself, not on paper.`;
      if (f.problem === "misspelled") return `Write the full word ${marker} on the product, in big letters.`;
      return `Write ${marker} on the product in permanent marker, in big letters.`;
    case "cut_cord":
      return "Cut the power cord all the way through, then show the cut ends in the photo.";
    case "cut_in_half":
      return "Cut it in half, then show both pieces in the photo.";
    case "remove_part":
      return "Remove the part the recall names, then show it removed in the photo.";
    case "puncture":
      return "Make the hole the recall asks for, then show it in the photo.";
    case "disassemble":
      return "Take it apart as the recall asks, then show the pieces in the photo.";
    default: {
      // The extractor's own owner step for this recall, for example "Cut both straps off the helmet."
      const step = rule.steps?.find((s) => !/photo|email|upload|send|stop using|unplug|dispose/i.test(s));
      if (step) return `${step.replace(/\.$/, "")}, then show it in the photo.`;
      return rule.explanation?.plain ? `Do this step first: ${rule.explanation.plain}` : "Do the step the recall asks for, then show it in the photo.";
    }
  }
}

export function madeSafeGuidance(findings: ActionFinding[], rule: VerifyProofRule, checks: Checks, recall: VerifyRecall, tip?: string): Guidance {
  const missing = findings.filter((f) => !f.done);
  const steps = missing.map((f) => actionStep(f, rule));
  const first = missing[0];
  let plain = "Almost there. The photo needs to show the product made safe.";
  if (first?.action === "write_recalled") plain = `Please write ${markerOf(rule).toUpperCase()} on the product first, then take a new photo.`;
  else if (first?.action === "cut_cord") plain = "Please cut the cord first, then take a new photo.";
  else if (first?.action === "cut_in_half") plain = "Please cut it in half first, then take a new photo.";
  if (checks.C1.status === "fail") steps.push(recall.products[0]?.name ? `Make sure the photo shows the recalled product: ${recall.products[0].name}.` : "Make sure the photo shows the recalled product.");
  steps.push("Take the photo in good light, with the whole product in view.");
  return {
    plain,
    steps,
    technical: `Retake: ${missing.map((f) => `${f.action} (${f.problem ?? "not confirmed"}): ${f.evidence}`).join("; ")}${tip ? `. Model tip: ${tip}` : ""}`,
  };
}

export const PERSON_PLAIN = "Please send a photo with only the product in it.";
const PERSON_STEPS = [
  "Take a new photo of just the product, with no one else in it.",
  "Your hand holding it is fine. Leave out faces and bodies.",
  "A photo that shows a person is deleted at once. Only a fingerprint of it is kept, for the record.",
];

export function guidanceFor(
  by: DecidedBy,
  args: { quality: QualityReport; checks: Checks; findings: ActionFinding[]; rule: VerifyProofRule; recall: VerifyRecall; tip?: string; person?: { kinds: string[]; where: string } | null },
): Guidance | undefined {
  if (by === "person") {
    const p = args.person;
    return {
      plain: PERSON_PLAIN,
      steps: PERSON_STEPS,
      technical: `Person in the photo (${p?.kinds.length ? p.kinds.join(", ") : "seen"}${p?.where ? `: ${p.where}` : ""}). Retake asked before any other check counts; the claim's stored photo bytes are deleted at once and only its SHA-256 and dHash are kept.`,
    };
  }
  if (by === "own_photo") return { plain: "Please send a photo of your own product.", steps: OWN_PHOTO_STEPS, technical: `Own-photo check: ${args.checks.C3.reason_technical}` };
  if (by === "quality") return qualityGuidance(args.quality);
  if (by === "made_safe") return madeSafeGuidance(args.findings, args.rule, args.checks, args.recall, args.tip);
  if (by === "unreadable") return { plain: "We could not open this photo. Please send it as a JPG or PNG.", steps: ["On iPhone, set Settings > Camera > Formats to Most Compatible, then take the photo again."], technical: "The image could not be decoded." };
  return undefined;
}

export function summaryFor(decision: Decision, by: DecidedBy, opts: { guidance?: Guidance; firmName?: string; blockers: Blocker[]; amount: AmountResult; checks: Checks }): { plain: string; technical: string } {
  const firm = opts.firmName ?? "the firm";
  const failing = opts.blockers.map((b) => b.why).join(", ");
  if (decision === "verified") {
    return {
      plain: "Your photo checks out.",
      technical: `${by === "reviewers" ? `Verified by two agreeing reviewers over soft items (${failing}).` : "All six checks passed."} ${opts.amount.technical}`,
    };
  }
  if (decision === "retake") return { plain: opts.guidance?.plain ?? "Please take the photo again.", technical: `Retake (${by}). ${opts.guidance?.technical ?? ""}`.trim() };
  // Each check carries its own plain reason; the summary only adds what no check shows.
  const why = opts.amount.overCap ? "The refund is above the amount the firm approves on its own." : opts.amount.missing ? "The firm has not set a refund amount yet." : "";
  return { plain: `A person at ${firm} will take a look. ${why}`.trim(), technical: `Firm review: ${failing || "no blockers"}. ${opts.amount.technical}` };
}
