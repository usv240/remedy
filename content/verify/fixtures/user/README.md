# Your photos for the verifier

Put photos of products you own here, with an `expected.json` beside them. `tests/verify.live.test.ts` picks up every image listed in `expected.json` and runs `verifyPhoto` on it against the named recall in `../recalls.json`.

Only use products you own. Please do not edit, draw on or composite a photo after taking it: the point is to test real photos.

## Shot list (plan section 12)

The verifier checks the product too (C1), so "verified" needs the photo to match the recall it is checked against. Against a recall for a different model, expect `firm_review` instead.

| ID | Photo | Use | Expected |
|---|---|---|---|
| P1 | Power bank with RECALLED written on it in marker | Preset `power-bank-marked` | verified, against its own recall |
| P2 | Small appliance with its power cord cut through, cut ends in view | Preset `cord-cut` | verified, against its own recall |
| P3 | Garment cut in half, both pieces in view | Preset `pajamas-cut` | verified, against its own recall |
| P4 | The same power bank as P1, before marking | Preset `not-yet-safe` | retake, "write RECALLED on the product first" |
| P5 | A different power bank model, marked RECALLED | Preset `look-alike` | firm_review, the Two reviewers run |
| T1 to T30 | 6 product types (power bank, charger cable, small appliance, toy, pillow, garment), 5 photos each, made safe, varied light and angle | Benchmark | verified for most; record what happens |
| T31 to T40 | 10 photos of a monitor showing official CPSC images | Benchmark, screen check | retake, "Please send a photo of your own product" |

Tips for the shot: whole product in view, good light, phone held still. For marker photos, write the word large enough to read across the room.

## expected.json

A map from file name to the recall it is checked against and what should happen. `decision` is one of `verified`, `retake` or `firm_review`; `checks` lists any check results you want asserted (`pass`, `fail`, `unclear`).

```json
{
  "P1-power-bank-marked.jpg": { "recall": "27056", "decision": "verified" },
  "P4-power-bank-unmarked.jpg": { "recall": "27056", "decision": "retake", "checks": { "C2": "fail" } },
  "P5-other-power-bank-marked.jpg": { "recall": "27056", "decision": "firm_review" },
  "T31-screen.jpg": { "recall": "27054", "decision": "retake", "checks": { "C3": "fail" } }
}
```

The recalls in `../recalls.json` are real CPSC recalls (27056 HAIARA power banks, write "recalled"; 27054 DREO space heaters, cut the cord; 27045 QZH.DUAO pajama sets, cut in half). Your product does not have to be the recalled one: a photo of a different product made safe is a fair test of the look-alike path, so set `decision` to what you expect (usually `firm_review`). To test a verified path, add the real recall your product belongs to in `recalls.json`, or ask the lead to add it.
