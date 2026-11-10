/**
 * The sample labels an owner can try with no product to hand, each with Claude's reading recorded once
 * (content/label/recorded/<id>.json) and replayed, labelled Recorded, with no model call. Client-safe: the page lists
 * them, the server replays them.
 */
export type LabelSample = {
  id: string;
  title: string;
  /** Served from public/. */
  src: string;
  alt: string;
  credit: string;
  /** The recall the label belongs to, or null for a label no recall lists. */
  expect: string | null;
  /** A label drawn for Remedy for its fictional sample recall. */
  drawn: boolean;
};

export const LABEL_SAMPLES: readonly LabelSample[] = [
  {
    id: "brightline",
    title: "Brightline charger",
    src: "/samples/label/brightline-blc-6520.png",
    alt: "A sample rating label for the Brightline 65W laptop charger, model BLC-6520, with its UPC barcode, input and output ratings and the date it was made, marked Sample label.",
    credit: "Sample label drawn for Remedy. Brightline Home, its charger and its recall are fictional.",
    expect: "BH-2026-01",
    drawn: true,
  },
  {
    id: "kidisle",
    title: "Kidisle coffee maker",
    src: "/samples/label/cpsc-26557-kidisle.jpg",
    alt: "The rating sticker on the underside of a coffee maker, reading Coffee Maker, Model KC101B, 120V 60Hz 1150W, Date 2527.",
    credit: "Photo: US Consumer Product Safety Commission, recall 26557.",
    expect: "26557",
    drawn: false,
  },
  {
    id: "lenovo",
    title: "Lenovo laptop adapter",
    src: "/samples/label/lenovo-65w-adapter.jpg",
    alt: "The label on a black Lenovo 65W 20V laptop AC adapter, with part number 92P1154 and FRU part number 42T5283, on a green background.",
    credit: "Photo: Siarhei Besarab, Wikimedia Commons, CC BY-SA 4.0, resized.",
    expect: null,
    drawn: false,
  },
];

export const labelSample = (id: string | null | undefined) => LABEL_SAMPLES.find((s) => s.id === id) ?? null;
