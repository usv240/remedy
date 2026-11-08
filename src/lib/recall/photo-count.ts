/**
 * How many photos a remedy asks for, read from the CPSC's own remedy text in plain code: "submit two photos: one photo
 * of both straps cut off and one photo of the helmet and cut straps inside a trash can" is two. Most remedies ask for
 * one. Where the text says what each photo shows ("one photo of ...", "the second photo should show ..."), those are
 * kept, in order, for the claim page. Pure.
 */
const NUM: Record<string, number> = { two: 2, three: 3, four: 4, "2": 2, "3": 3, "4": 4 };
const PHOTO = "(?:photos?|photographs?|pictures?|images?)";

export type PhotoAsk = { count: number; shows: string[] };

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^(?:should\s+)?(?:show|be(?: of)?|of)\s+/i, "")
    .replace(/\s+and\s+(?:dispose|send|email|upload|submit|mail)\b.*$/i, "")
    .replace(/[\s,;:.]+$/, "")
    .trim();

export function photoAsk(remedyText: string | null | undefined): PhotoAsk {
  const t = (remedyText ?? "").replace(/\s+/g, " ");
  let count = 1;
  for (const m of t.matchAll(new RegExp(`\\b(two|three|four|2|3|4)\\s+(?:separate\\s+|clear\\s+|different\\s+)?${PHOTO}\\b`, "gi"))) count = Math.max(count, NUM[m[1].toLowerCase()]);
  // "a picture of the UPC code ... and a picture of the date code": two photos named one by one.
  const paired = t.match(new RegExp(`\\b(?:a|one)\\s+${PHOTO}\\s+of\\s+([^.;]{3,120}?)\\s+and\\s+(?:a|one)\\s+${PHOTO}\\s+of\\s+([^.;]{3,120})`, "i"));
  if (paired) count = Math.max(count, 2);

  // What each photo shows, where the text says it.
  const shows: string[] = [];
  if (paired) shows.push(clean(paired[1]), clean(paired[2]));
  else {
    const ordinal = [...t.matchAll(new RegExp(`\\b(?:one|first|second|third|last|the other)\\s+${PHOTO}\\s+(?:should\\s+)?(?:show|be(?: of)?|of)\\s+([^.;]{3,140})`, "gi"))].map((m) => clean(m[1]));
    const listed = t.match(new RegExp(`${PHOTO}\\s*[:;]\\s*one\\s+(?:of\\s+)?([^,;.]{3,120})[,;]?\\s+and\\s+one\\s+(?:of\\s+)?([^.;]{3,120})`, "i"));
    if (ordinal.length >= 2) shows.push(...ordinal);
    else if (listed) shows.push(clean(listed[1]), clean(listed[2]));
  }
  return { count: Math.min(4, count), shows: shows.length === count ? shows : [] };
}
