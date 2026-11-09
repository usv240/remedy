/**
 * One line under the console's counters that says what each counts and why they differ, computed from the same
 * figures (homeSummary in ./home.ts): claims verified counts claims, units corrected counts the units those claims
 * cover, and refunds paid counts the payments that landed. Pure and client safe; tests/firm.test.ts checks it.
 */
import type { HomeSummary } from "./types";

const n = (x: number) => x.toLocaleString("en-US");

export function kpiReconcile(s: Pick<HomeSummary, "claimsVerified" | "unitsCorrected" | "refundsPaid" | "verifiedBy">): string {
  const v = s.verifiedBy;
  const parts = [
    v.paid ? `${n(v.paid)} ${v.paid === 1 ? "is" : "are"} paid` : "",
    v.waiting ? `${n(v.waiting)} ${v.waiting === 1 ? "was" : "were"} sent and ${v.waiting === 1 ? "waits" : "wait"} to be accepted` : "",
    v.unpaid ? `${n(v.unpaid)} ${v.unpaid === 1 ? "is" : "are"} not paid yet` : "",
    v.other ? `${n(v.other)} ${v.other === 1 ? "is" : "are"} on the way` : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "none is paid yet");
  const u = `${n(s.unitsCorrected)} ${s.unitsCorrected === 1 ? "unit" : "units"}`;
  const units = s.unitsCorrected === s.claimsVerified ? `together they cover ${u}, one each` : `together they cover ${u}, as a claim can cover more than one`;
  const extra = s.refundsPaid.count !== v.paid ? `; refunds paid counts every payment that landed on this recall, ${n(s.refundsPaid.count)} in all` : "";
  return `Of the ${n(s.claimsVerified)} verified ${s.claimsVerified === 1 ? "claim" : "claims"}, ${list}; ${units}${extra}.`;
}
