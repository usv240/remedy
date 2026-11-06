/**
 * The recall shapes Remedy reads and writes. `content/recalls/recalls.json` holds `RecallsFile`; the app's loader,
 * search, the proof-rule extractor and the stats script all use these types.
 */

/** What the remedy text asks for, from the deterministic classifier in `classify.ts`. */
export type RecallFlags = {
  /** The remedy mentions a photo, picture or image. */
  photo: boolean;
  /** The remedy mentions a refund. */
  refund: boolean;
  /** The remedy asks the owner to write or mark words on the product (for example "RECALLED" in marker). */
  marker: boolean;
  /** The remedy asks the owner to cut something (a cord, the product in half). */
  cut: boolean;
  /** The remedy or the consumer contact gives an email address. */
  email: boolean;
  /** One of those addresses is on a free webmail domain (see `WEBMAIL_DOMAINS`). */
  webmail: boolean;
};

export type RecallProduct = {
  name: string;
  model: string;
  description: string;
  /** CPSC product type, for example "Batteries" or "Heaters". */
  type: string;
  /** Units for this product, parsed from `unitsText`; null when CPSC gives no number. */
  units: number | null;
  /** The units text exactly as CPSC published it, for example "About 11,000 (In addition, about 900 in Canada)". */
  unitsText: string;
};

/** `file` (a repo path) and `dhash` are set only on sample recalls, whose images ship with the app. */
export type RecallImage = { url: string; caption: string; file?: string; dhash?: string };

export type RecallFirm = { name: string; role: "manufacturer" | "importer" | "distributor" };

export type Recall = {
  /** CPSC recall number, for example "27056"; or a fictional sample recall's number, for example "BH-2026-01". */
  number: string;
  /** A fictional sample recall from content/recalls/samples.json, never a CPSC recall. Absent on CPSC recalls. */
  sample?: true;
  title: string;
  /** Recall date, YYYY-MM-DD. */
  date: string;
  /** US units of the first product, as CPSC counts recalls; null when not given. */
  units: number | null;
  hazard: string;
  /** The official remedy text, every remedy paragraph joined with a space. */
  remedyText: string;
  /** CPSC remedy options, for example ["Refund", "Replace"]. */
  remedies: string[];
  products: RecallProduct[];
  images: RecallImage[];
  /** Where it was sold, each entry as CPSC wrote it. */
  retailers: string[];
  /** Firm names: manufacturers, then importers, then distributors (see `firms` for roles). */
  manufacturers: string[];
  consumerContact: string;
  /** The recall page on cpsc.gov. */
  url: string;
  /** The remedy asks for a photo and pays a refund (`flags.photo && flags.refund`). */
  photoRefund: boolean;
  flags: RecallFlags;
  // Extra fields, kept so nothing in the source needs a second pull.
  /** Plain-words product category for filters (CPSC's own product type is blank on most recalls). */
  category: string;
  recallId: number;
  description: string;
  injuries: string[];
  firms: RecallFirm[];
  countries: string[];
  upcs: string[];
  /** Every email address in the remedy text or the consumer contact, lower case, in order of appearance. */
  emails: string[];
  lastPublishDate: string;
};

export type RecallsFile = {
  pulledAt: string;
  source: string;
  /** Recall dates covered, YYYY-MM-DD. */
  range: { from: string; to: string };
  count: number;
  recalls: Recall[];
};

/** One record from the CPSC Recalls REST API (`saferproducts.gov/RestWebServices/Recall`). */
export type RawCpscRecall = {
  RecallID?: number;
  RecallNumber?: string;
  RecallDate?: string;
  Description?: string;
  URL?: string;
  Title?: string;
  ConsumerContact?: string;
  LastPublishDate?: string;
  Products?: { Name?: string; Description?: string; Model?: string; Type?: string; CategoryID?: string; NumberOfUnits?: string }[];
  Images?: { URL?: string; Caption?: string }[];
  Injuries?: { Name?: string }[];
  Manufacturers?: { Name?: string; CompanyID?: string }[];
  Retailers?: { Name?: string; CompanyID?: string }[];
  Importers?: { Name?: string; CompanyID?: string }[];
  Distributors?: { Name?: string; CompanyID?: string }[];
  ManufacturerCountries?: { Country?: string }[];
  ProductUPCs?: { UPC?: string }[] | string[];
  Hazards?: { Name?: string; HazardType?: string; HazardTypeID?: string }[];
  Remedies?: { Name?: string }[];
  RemedyOptions?: { Option?: string }[];
};
