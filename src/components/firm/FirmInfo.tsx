import { Info } from "@/components/Info";
import { FIRM_INFO, type FirmInfoId } from "@/lib/firm/info";

/** An Info button with the firm console's own entry (src/lib/firm/info.ts). */
export function FirmInfo({ id, topic, label }: { id: FirmInfoId; topic?: string; label?: string }) {
  return <Info id={id} entry={FIRM_INFO[id]} topic={topic} label={label} />;
}
