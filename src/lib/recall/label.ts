/**
 * How a recall is named and credited wherever it appears: the firm console, the recall plan, the monthly report,
 * payouts and refunds, notices, receipts and the API. A real recall is a CPSC recall, with its data and images credited
 * to the CPSC. Brightline Home's fictional sample recall (content/recalls/samples.json) is a sample recall, with its
 * photos credited to their photographer, and never called a CPSC recall. Pure, so client code and tests can use it.
 */

/**
 * The fictional sample firms' recalls are numbered with two letters, the year and a count ("BH-2026-01" for Brightline
 * Home, "FW-2026-01" for Fernway Home), a form no CPSC recall uses, so a sample can never be mistaken for a real recall
 * number. Fernway Home is the second sample firm: it sells the same sample charger under its own name, and its recall
 * shows the hash check that runs across firms.
 */
export const SAMPLE_FIRMS = { BH: "Brightline Home", FW: "Fernway Home" } as const;
export const SAMPLE_NUMBER = /^(?:BH|FW)-\d{4}-\d{2}$/;
export const isSampleNumber = (s: string) => SAMPLE_NUMBER.test(s);
/** The fictional firm that runs a sample recall: "Brightline Home" for BH-2026-01. Null for a CPSC recall. */
export const sampleFirmOf = (n: string): string | null => (isSampleNumber(n) ? SAMPLE_FIRMS[n.slice(0, 2) as keyof typeof SAMPLE_FIRMS] : null);

/** Who took the sample recall's photos (content/recalls/samples.json, public/samples/charger/CREDITS.json). */
export const SAMPLE_PHOTO_CREDIT = "Photo: Dmitry G, Wikimedia Commons, public domain; brand marks removed for this sample";

/** "sample recall BH-2026-01" for the sample, "CPSC recall 27056" for a real one. Lower case, for the middle of a sentence. */
export const recallLabel = (n: string) => (isSampleNumber(n) ? `sample recall ${n}` : `CPSC recall ${n}`);

/** The same at the start of a sentence: "Sample recall BH-2026-01", "CPSC recall 27056". */
export const RecallLabel = (n: string) => {
  const s = recallLabel(n);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Where a recall's photo and data come from, as one sentence. */
export const recallCredit = (n: string) =>
  isSampleNumber(n) ? `${SAMPLE_PHOTO_CREDIT}. Sample recall; ${sampleFirmOf(n)} and its recall are fictional.` : "Photo and recall data: US Consumer Product Safety Commission.";

/** Where a recall's figures come from, for a report's source column: "the sample recall's data" or "CPSC recall data". */
export const recallDataSource = (n: string) => (isSampleNumber(n) ? "the sample recall's data" : "CPSC recall data");
