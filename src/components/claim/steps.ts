/**
 * The owner's checklist, from a proof rule's steps. Pure, so the claim page, /try and the tests share it.
 * Steps that say to email or upload the photo to the firm become "Send the photo here": on Remedy the photo is sent on
 * the page, and the refund is paid by the sample firm in the sandbox.
 */

export type StepKind = "stop" | "cut_cord" | "cut_in_half" | "write" | "photo" | "send" | "dispose" | "remove" | "other";
export type OwnerStep = { text: string; kind: StepKind; info: "claim.step.cut_cord" | "claim.step.cut_in_half" | "claim.step.write" | "claim.step.photo" | "claim.step.send" | "claim.step.stop" | "claim.step.dispose" | "claim.step.other" };

const INFO_FOR: Record<StepKind, OwnerStep["info"]> = {
  stop: "claim.step.stop",
  cut_cord: "claim.step.cut_cord",
  cut_in_half: "claim.step.cut_in_half",
  write: "claim.step.write",
  photo: "claim.step.photo",
  send: "claim.step.send",
  dispose: "claim.step.dispose",
  remove: "claim.step.other",
  other: "claim.step.other",
};

/** What kind of step a sentence is, for its drawing and its "why". */
export function stepKind(text: string): StepKind {
  const t = text.toLowerCase();
  if (/\b(e-?mail|upload|submit|send|mail)\b/.test(t) && /\b(photo|picture|image|it|them)\b/.test(t)) return "send";
  if (/\b(take|snap)\b.*\b(photo|picture)|\bphotograph\b/.test(t)) return "photo";
  if (/\b(write|mark|label)\b/.test(t)) return "write";
  if (/\bcut\b.*\b(cord|cable|wire|plug)s?\b|\b(cord|cable)s?\b.*\bcut\b/.test(t)) return "cut_cord";
  if (/\bcut\b.*\b(in half|in two|into pieces|apart|through)\b/.test(t)) return "cut_in_half";
  if (/\b(dispose|throw|discard|recycle|trash)\b/.test(t)) return "dispose";
  if (/\b(stop using|unplug|stop use)\b/.test(t)) return "stop";
  if (/\b(remove|detach|take off|unscrew)\b/.test(t)) return "remove";
  return "other";
}

const SEND_HERE = "Send the photo here. Remedy checks it for you.";

/** Up to four steps, in order, with the send step written for Remedy and nothing repeated. */
export function ownerSteps(rule: { steps: readonly string[]; actions: readonly string[]; marker_text?: string | null }): OwnerStep[] {
  const out: OwnerStep[] = [];
  for (const raw of rule.steps) {
    const kind = stepKind(raw);
    const text = kind === "send" ? SEND_HERE : raw.trim().replace(/\s+/g, " ");
    if (!text || out.some((s) => s.text === text)) continue;
    out.push({ text, kind, info: INFO_FOR[kind] });
  }
  // A rule with no written steps still gets its actions as steps.
  if (!out.length) {
    for (const a of rule.actions) {
      if (a === "cut_cord") out.push({ text: "Cut the power cord all the way through.", kind: "cut_cord", info: INFO_FOR.cut_cord });
      else if (a === "cut_in_half") out.push({ text: "Cut it in half.", kind: "cut_in_half", info: INFO_FOR.cut_in_half });
      else if (a === "write_recalled") out.push({ text: `Write ${(rule.marker_text || "RECALLED").toUpperCase()} on it in permanent marker.`, kind: "write", info: INFO_FOR.write });
      else out.push({ text: "Make it unusable as the recall asks.", kind: "other", info: INFO_FOR.other });
    }
    out.push({ text: "Take one photo that shows the whole product.", kind: "photo", info: INFO_FOR.photo });
  }
  if (!out.some((s) => s.kind === "send")) out.push({ text: SEND_HERE, kind: "send", info: INFO_FOR.send });
  // Keep the send step when trimming to four: it is the one this page does.
  if (out.length > 4) {
    const send = out.find((s) => s.kind === "send")!;
    const rest = out.filter((s) => s !== send);
    const disposeAt = rest.findIndex((s) => s.kind === "dispose");
    const kept = rest.filter((_, i) => i !== disposeAt || rest.length <= 3).slice(0, 3);
    return [...kept, send];
  }
  return out;
}

/** The word the owner writes, in capitals, when the rule asks for one. */
export const markerWord = (rule: { actions: readonly string[]; marker_text?: string | null }) =>
  rule.actions.includes("write_recalled") ? (rule.marker_text || "RECALLED").toUpperCase() : null;
