# The verifier's photo set

Remedy's verifier is tested on photos that are honestly what they say. None of them is an owner's own claim photo, and nothing was drawn on or edited to look made safe. Every file, its source, author and license is in `../credits.json`. On `/try` they are shown as "a test photo from Wikimedia Commons" or "the CPSC's published example", never as a customer's claim.

## What is in the set

| Kind | Files | Source and license | What it tests |
|---|---|---|---|
| Official recall images | `official/27056-*`, `27054-*`, `27045-*`, `25007-droyd-1..3`, `26754-*` | U.S. CPSC, public domain | "Please send a photo of your own product" (C3, by perceptual hash) and the product reference for C1 |
| The CPSC's published made-safe examples | `official/26125-hair-dryer-cord-cut.png`, `official/25007-droyd-4-straps-cut.jpg`, `official/25007-droyd-5-in-trash.jpg` | U.S. CPSC, recalls 26125 and 25007, public domain | Claim path: recognized as the recall's own example (C3). With that match set aside: right product (C1) and made safe (C2) |
| Look-alike power banks | `other/commons-powerbank-oraimo.jpg`, `other/commons-powerbank-romoss.jpg` | Wikimedia Commons, CC BY-SA 4.0 (Reladex; Shwangtianyuan) | A different model is not the recalled HAIARA power bank (C1), never verified |
| A photo of a computer screen | `derived/commons-deskck-lower-monitor.crop.jpg`, a crop of `other/commons-deskck-monitors.jpg` | Wikimedia Commons, public domain (GuitarFreak) | The screen-or-printout part of C3 |
| An unrelated object, and a blurred copy | `other/commons-coffee-in-a-mug.jpg`, `derived/commons-coffee-in-a-mug.blur8.jpg` | Wikimedia Commons, CC0 (Kurt Kaiser) | C1 mismatch; the blur precheck |
| Copies of official images | `derived/27056-haiara-1.rotated90-q55.jpg`, `derived/27054-dreo-2.tilt4-crop-q60.jpg` | Made with sharp from CPSC images, public domain | A turned or cropped copy is still caught by the hash |

The known answers are in `../cases.json`; `scripts/verify/sweep.ts` and `tests/verify.live.test.ts` run them against Claude, and the unit tests run the cases that need no model.

## What the set cannot show yet

There is no photo here of a recalled product made safe by its own owner, so the fully verified path (a real owner's power bank marked RECALLED, checked against its own recall) is shown only with the CPSC's published examples, with the official-image match set aside. The screen photo shows a wallpaper, not a recall picture, so it tests the screen check only partly.

## Adding photos later

If the team photographs products it owns, put them here with an `expected.json` beside them. The live test and `/try` pick up every listed image that exists:

```json
{
  "P1-power-bank-marked.jpg": { "recall": "27056", "decision": "verified" },
  "T31-screen.jpg": { "recall": "27054", "decision": "retake", "checks": { "C3": "fail" } }
}
```

`decision` is `verified`, `retake` or `firm_review`; `checks` lists results to assert (`pass`, `fail`, `unclear`). Only use products you own, and do not edit a photo after taking it. The most useful additions match plan section 12: a product made safe and checked against its own recall (P1 to P3), the same product before it is made safe (P4), a different model made safe (P5), and photos of a monitor showing the official CPSC image (T31 to T40).
