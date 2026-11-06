"use client";

import { Info } from "@/components/Info";
import { CLAIM_INFO, type ClaimInfoId } from "./info";

/** The shared Info toggletip, with the owner flow's own entries. */
export function ClaimInfo({ k, label = "", topic }: { k: ClaimInfoId; label?: string; topic?: string }) {
  return <Info id={k} entry={CLAIM_INFO[k]} label={label} topic={topic} />;
}
