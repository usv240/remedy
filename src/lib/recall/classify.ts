/**
 * The deterministic recall classifier. Every published number about CPSC recalls comes from these rules, so they are
 * plain regular expressions over the official fields, kept here with their exact definitions (see `DEFINITIONS`).
 * `scripts/recalls/stats.ts` runs them over the whole pull and writes `content/recalls/stats.json`.
 */
import type { RawCpscRecall, RecallFlags } from "./types";

/** Free webmail domains counted as "webmail". Exact domain match on every address in the remedy or consumer contact. */
export const WEBMAIL_DOMAINS = [
  "outlook.com",
  "163.com",
  "gmail.com",
  "hotmail.com",
  "126.com",
  "qq.com",
  "yeah.net",
  "sina.com",
  "yahoo.com",
  "foxmail.com",
  "aol.com",
  "icloud.com",
] as const;

export const PHOTO_RE = /photo|picture|image/i;
export const REFUND_RE = /refund/i;
/** Writing or marking words on the product: a marker (also the common typo "permanent maker"), or write/mark followed by the words to write. */
export const MARKER_RE =
  /\bmarkers?\b|\bpermanent\s+maker\b|\b(?:write|writes|writing|written|wrote|mark|marks|marking)\b[^.]{0,60}?["“”'‘’]\s*(?:recall(?:ed)?|do not use|destroyed|void)\b/i;
export const CUT_RE = /\bcut(?:s|ting)?\b/i;
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const PAYPAL_RE = /paypal|venmo/i;
/** "Sold online": the retailer text says online or names a .com store. */
export const ONLINE_RE = /online|\.com\b/i;
/** Professional recall vendors named in the consumer contact. */
export const VENDOR_RE = /sedgwick|expertinquiry|stericycle|recallrtr/i;

const join = (xs: { Name?: string }[] | undefined) => (xs ?? []).map((x) => x.Name ?? "").join(" ");

export const remedyTextOf = (r: RawCpscRecall) => join(r.Remedies);

/** Every email address in the text, lower case, trailing dots trimmed, in order, without repeats. */
export function emailsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/\.+$/, "");
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

export const domainOf = (email: string) => email.split("@")[1] ?? "";
export const isWebmail = (email: string) => (WEBMAIL_DOMAINS as readonly string[]).includes(domainOf(email));

/** The six flags, from the remedy text and the consumer contact alone. */
export function classifyRemedy(remedyText: string, consumerContact = ""): RecallFlags {
  const emails = emailsIn(`${remedyText} ${consumerContact}`);
  return {
    photo: PHOTO_RE.test(remedyText),
    refund: REFUND_RE.test(remedyText),
    marker: MARKER_RE.test(remedyText),
    cut: CUT_RE.test(remedyText),
    email: emails.length > 0,
    webmail: emails.some(isWebmail),
  };
}

/**
 * Units from CPSC's text: the first number, times a million when "million" follows it. "About 25,541 (In addition, about
 * 5,534 sold in Canada)" is 25,541; "About 8.2 million" is 8,200,000. Null when there is no number.
 */
export function parseUnits(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(million|thousand)?/i);
  if (!m) return null;
  const mult = m[2] ? (m[2].toLowerCase() === "million" ? 1e6 : 1e3) : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

export type UnitsBucket = "under 1,000" | "1,000 to 9,999" | "10,000 to 49,999" | "50,000 to 999,999" | "1 million or more" | "not given";
export function unitsBucket(units: number | null): UnitsBucket {
  if (units === null) return "not given";
  if (units < 1_000) return "under 1,000";
  if (units < 10_000) return "1,000 to 9,999";
  if (units < 50_000) return "10,000 to 49,999";
  if (units < 1_000_000) return "50,000 to 999,999";
  return "1 million or more";
}

/** Plain-words product categories for search filters. CPSC's own product type is blank on most recent recalls. */
const CATEGORIES: [string, RegExp][] = [
  ["Batteries and chargers", /power ?banks?|portable charger|batter(y|ies)|chargers?\b|power stations?|jump starters?/i],
  ["Heaters", /heaters?\b|heating pads?|electric blankets?|warmers?\b|fireplaces?|boilers?|furnaces?/i],
  ["Sleepwear and clothing", /pajamas?|sleepwear|nightgowns?|robes?\b|loungewear|hoodies?|sweatshirts?|jackets?|dresses|shirts?\b|pants\b|leggings|onesies?|clothing|garments?|sweaters?|shoes|sneakers|boots\b|sandals/i],
  ["Baby and nursery", /\bbab(y|ies)\b|infants?|cribs?|bassinets?|strollers?|car seats?|high ?chairs?|nursing|pacifiers?|teethers?|loungers?|bouncers?|swaddl|sleepers?|playards?|play yards?|baby gates?|bath seats?|walkers?\b|carriers?\b|changing (table|pad)/i],
  ["Toys and games", /\btoys?\b|dolls?|plush|games?\b|puzzles?|blocks\b|squishy|slime|rattles?|play ?sets?|kids'? (drum|tablet)/i],
  ["Furniture", /dressers?|chests?\b|desks?|cabinets?|bookcases?|shelves|shelving|tables?\b|chairs?\b|sofas?|beds?\b|bed frames?|headboards?|stools?|nightstands?|tv stands?|wardrobes?|mattress(es)?/i],
  ["Bed rails and mobility", /bed rails?|bed handles?|rollators?|mobility|wheelchairs?|grab bars?/i],
  ["Kitchen and appliances", /coffee|kettles?|blenders?|cookers?|fryers?|ovens?|toasters?|mixers?|pressure cookers?|kitchen|cookware|pans?\b|pots?\b|knives|knife|microwaves?|refrigerators?|freezers?|dishwashers?|water bottles?|tumblers?|mugs?|cups?\b|jars?\b|lunch|grills?/i],
  ["Lights and electrical", /lamps?|lights?\b|lighting|lanterns?|flashlights?|extension cords?|power strips?|outlets?|surge|smart plugs?|cables?\b|adapters?|fans?\b|dehumidifiers?|humidifiers?|air purifiers?|air conditioners?/i],
  ["Personal care", /hair ?dryers?|curling|straighteners?|massagers?|shavers?|razors?|toothbrush|cosmetic|lotion|sunscreen|wipes\b|diapers?|tampons?|candles?/i],
  ["Bikes, scooters and outdoor", /e-?bikes?|bicycles?|bikes?\b|scooters?|helmets?|hoverboards?|skateboards?|atvs?|off-road|ut(v|vs)\b|golf carts?|pools?\b|drain covers?|trampolines?|hammocks?|tents?\b|camping|kayaks?|boats?/i],
  ["Tools and home improvement", /pressure washers?|saws?\b|drills?|ladders?|generators?|mowers?|trimmers?|chainsaws?|tools?\b|hatchets?|axes\b|leaf blowers?|snow ?blowers?|garage doors?|fuel (cans?|containers?)/i],
  ["Fitness and sports", /treadmills?|exercise|fitness|weights?|dumbbells?|kettlebells?|yoga|rowing|bikes? trainers?|balls?\b|medals?|saunas?/i],
  ["Pet products", /\bpets?\b|dogs?\b|cats?\b|leash(es)?|collars?\b|aquariums?/i],
];
export function categorize(title: string, productNames: string[], cpscType = ""): string {
  const hay = `${productNames.join(" ")} ${title}`;
  for (const [name, re] of CATEGORIES) if (re.test(productNames.join(" "))) return name;
  for (const [name, re] of CATEGORIES) if (re.test(hay)) return name;
  return cpscType.trim() || "Other";
}

/** The exact definition of every counted measure, written next to the number in `stats.json`. */
export const DEFINITIONS = {
  recalls: "Every CPSC recall the Recalls API returns with RecallDate on or after the start date, de-duplicated by RecallNumber.",
  photo: `Remedy text (all Remedies[].Name joined) matches ${PHOTO_RE} (case-insensitive).`,
  refund: `Remedy text matches ${REFUND_RE}.`,
  photoRefund: "Both photo and refund.",
  email: `Remedy text or ConsumerContact contains an email address (${EMAIL_RE.source}).`,
  webmail: `At least one of those addresses is on one of these domains, exact match: ${WEBMAIL_DOMAINS.join(", ")}.`,
  marker: `Remedy text matches ${MARKER_RE.source} (a marker, or write or mark followed by quoted words such as "RECALLED").`,
  cut: `Remedy text matches ${CUT_RE.source}.`,
  paypal: `Remedy text or ConsumerContact matches ${PAYPAL_RE}.`,
  units: "First number in Products[0].NumberOfUnits, times one million when followed by \"million\". US units as CPSC states them; Canada and Mexico counts in parentheses are not added.",
  online: `Retailers[].Name joined matches ${ONLINE_RE}.`,
  china: "ManufacturerCountries includes exactly \"China\".",
  vendor: `ConsumerContact matches ${VENDOR_RE} (professional recall vendors).`,
  year: "Year of RecallDate.",
} as const;
