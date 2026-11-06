/**
 * The firm the console runs for, and its recalls. In this build that is Brightline Home, the fictional sample firm
 * (firm.is_sample = true, seeded by scripts/seed.ts). Server only.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import demoPicks from "../../../content/recalls/demo-picks.json";
import samples from "../../../content/recalls/samples.json";

export type Firm = { id: number; name: string; slug: string; isSample: boolean; settings: FirmSettings };
export type FirmSettings = { autoApproveCap?: number; dailyPayoutCap?: number; reviewHours?: number; replyName?: string };

export type FirmRecall = {
  number: string;
  title: string;
  /** The product's own name from the recall ("HAIARA power banks"), for tight spaces. */
  short: string;
  date: string;
  units: number | null;
  unitsText: string;
  announced: string;
  autoCapCents: number;
  url: string;
  image: string | null;
  products: { name: string; model?: string }[];
};

/**
 * The sample firm's main recall: its own fictional sample recall (content/recalls/samples.json), so the queue, the
 * plan and the monthly report describe Brightline's own recall. The real CPSC demo picks stay linked as extra recalls.
 */
export const SAMPLE_RECALL = String((samples as { recalls: { number: string }[] }).recalls[0]?.number ?? (demoPicks as { picks: { number: string }[] }).picks[0]?.number ?? "27056");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];

export async function sampleFirm(): Promise<Firm | null> {
  const [r] = await rows<{ id: number; name: string; slug: string; is_sample: boolean; settings: FirmSettings }>(
    sql`select id, name, slug, is_sample, settings from firm where is_sample = true order by id limit 1`,
  );
  return r ? { id: r.id, name: r.name, slug: r.slug, isSample: r.is_sample, settings: r.settings ?? {} } : null;
}

/** A short product name: the recall's first product, else the title up to "Recalled" or "Due to". */
export function shortName(title: string, products: { name?: string }[] | null | undefined): string {
  const p = products?.find((x) => x?.name)?.name?.trim();
  if (p) return p.length > 48 ? `${p.slice(0, 46).trimEnd()}…` : p;
  return title.split(/\s+(?:Recalled|Recalls|Due to)\b|;/)[0].trim();
}

/** The thumbnail the data builder saved for a recall (public/recalls/<number>/1.webp), credited to the CPSC. */
export function recallThumb(number: string): string | null {
  const file = path.join(process.cwd(), "public", "recalls", number, "1.webp");
  return existsSync(file) ? `/recalls/${number}/1.webp` : null;
}

export async function firmRecalls(firmId: number): Promise<FirmRecall[]> {
  const list = await rows<{ number: string; title: string; date: string; units: number | null; units_text: string; announced_on: string | null; auto_cap: string; url: string; products: FirmRecall["products"] }>(sql`
    select r.number, r.title, to_char(r.date, 'YYYY-MM-DD') as date, r.units, r.units_text, to_char(fr.announced_on, 'YYYY-MM-DD') as announced_on,
           fr.auto_cap, r.url, r.products
    from firm_recall fr join recall r on r.number = fr.recall_number
    where fr.firm_id = ${firmId} and fr.status = 'active'
    order by (r.number = ${SAMPLE_RECALL}) desc, r.date desc, r.number`);
  return list.map((r) => ({
    number: r.number,
    title: r.title,
    short: shortName(r.title, r.products),
    date: r.date,
    units: r.units,
    unitsText: r.units_text,
    announced: r.announced_on ?? r.date,
    autoCapCents: Math.round(Number(r.auto_cap) * 100),
    url: r.url,
    image: recallThumb(r.number),
    products: r.products ?? [],
  }));
}

/** The firm and its recalls, or null when the sample firm is not seeded. */
export async function firmContext() {
  const firm = await sampleFirm();
  if (!firm) return null;
  const recalls = await firmRecalls(firm.id);
  return { firm, recalls, main: recalls[0] ?? null };
}
