import type { InfoEntry } from "@/components/Info";

/**
 * Info entries for the owner's claim flow, /try and the receipt. Kept beside the components that use them so the
 * owner's path ships as one piece; the lead may merge them into content/info.json (same shape, same tone rules).
 */
export const CLAIM_INFO = {
  "claim.recall": {
    title: "Your recall number",
    what: "Every US recall has a number from the Consumer Product Safety Commission (CPSC). It names the product, the hazard and the remedy.",
    why: "The number ties your photo to the official recall, so the checks use that recall's own pictures and rules.",
    technical: "Recall data comes from the CPSC Recalls API (public domain). Remedy keeps every recall since January 2024.",
    learnMore: { label: "How recalls work", href: "/learn" },
  },
  "claim.steps": {
    title: "Make it safe",
    what: "These steps come from the recall's own remedy, rewritten as a short checklist.",
    why: "Making the product unusable means no one can be hurt by it later, and it is what the firm asks for before it pays.",
    technical: "Each recall's remedy text is read into a proof rule (actions, what the photo must show, the remedy) by Claude Opus 5.5 with structured output, or by Remedy's keyword rules when no stored rule exists.",
    sponsor: ["Claude"],
  },
  "claim.step.cut_cord": {
    title: "Why cut the cord",
    what: "Cut the power cord all the way through, close to the product.",
    why: "With the cord cut, the product cannot be plugged in again, so it cannot shock or burn anyone.",
  },
  "claim.step.cut_in_half": {
    title: "Why cut it in half",
    what: "Cut the item in two, so the pieces are clearly apart.",
    why: "A product in two pieces cannot be worn, used or passed on to someone else.",
  },
  "claim.step.write": {
    title: "Why write on it",
    what: "Write the word in big letters on the product itself, in permanent marker.",
    why: "Anyone who finds it later can see it is recalled, and the photo shows the firm it is marked.",
  },
  "claim.step.photo": {
    title: "Why one photo",
    what: "One clear photo of the whole product, with the cut or the writing in view.",
    why: "The photo shows the firm the product was made safe, so it can pay you without asking for the product back.",
  },
  "claim.step.send": {
    title: "Why send it here",
    what: "You send the photo on this page instead of by email.",
    why: "Remedy checks the photo in seconds and the refund is paid straight away, with no wait for someone to read an inbox.",
  },
  "claim.step.stop": {
    title: "Why stop using it",
    what: "Stop using the product now and unplug it if it has a plug.",
    why: "The recall found a hazard. Not using it is the first way to stay safe.",
  },
  "claim.step.dispose": {
    title: "Why dispose of it",
    what: "After your refund, throw it away or recycle it the way your town asks.",
    why: "Batteries and electronics can need special disposal, and a product that is gone cannot hurt anyone.",
  },
  "claim.step.other": {
    title: "Why this step",
    what: "The recall asks for this step to make the product unusable.",
    why: "Each step comes from the recall's own remedy, so the firm can pay for a photo instead of a return.",
  },
  "claim.example": {
    title: "A photo the firm accepts",
    what: "The CPSC published this photo with a recall as an example of a product made safe.",
    why: "Seeing a real example makes it easy to take a photo that passes the first time.",
    technical: "Image: US Consumer Product Safety Commission, public domain. Remedy recognizes this exact picture and asks for your own photo if it is sent as a claim.",
  },
  "claim.photo": {
    title: "Your photo",
    what: "Take the photo with your phone camera, or choose one you already took. Show just the product, with no people in it. JPEG or PNG, up to 15 MB.",
    why: "A clear photo of your own product is all the firm needs. No account is needed. The photo is kept without camera or location data and deleted 90 days after your claim is decided; a photo that shows a person is deleted at once.",
    technical: "The photo is stored as a resized JPEG that sharp re-encodes with no EXIF or GPS metadata; the untouched upload is cleared once the checks have run. Its SHA-256 and 64-bit difference hash stay after the bytes are deleted, so the earlier-claim check still knows a photo that was paid or reviewed (src/lib/ops/photos.ts). It is sent to Claude Opus 5.5 only for the checks. The blur check here runs in your browser before upload.",
    sponsor: ["Claude"],
  },
  "claim.checks": {
    title: "The six checks",
    what: "Right product, made safe, your own photo, within the recall, claim limits, and not already refunded.",
    why: "Together they make sure the refund goes to a real owner whose product is now safe, which keeps the refund pool for real owners.",
    technical: "C1 and C2 come from one Claude vision call with structured output. C3 compares a perceptual hash with the recall's official images and earlier claims. C4 to C6 are code, and C6 asks PayPal about any linked purchase. The decision is made in code, never by the model.",
    sponsor: ["Claude", "PayPal"],
  },
  "check.C1": { title: "Right product", what: "The photo shows the recalled product.", why: "The refund is for this recall's product, so the photo is compared with the official CPSC pictures and model details." },
  "check.C2": { title: "Made safe", what: "The photo shows the step the recall asks for, such as a cut cord or the word RECALLED.", why: "This is what makes the product unusable, and what the firm pays for." },
  "check.C3": { title: "Your own photo", what: "The photo is a new camera photo, not the recall's picture, a screen or an earlier claim.", why: "It keeps each refund for the person who has the product." },
  "check.C4": { title: "Within the recall", what: "When the recall covers some models, lots or dates only, the photo's label is read and compared.", why: "Only the recalled units are refunded, so an unaffected unit can still be used." },
  "check.C5": { title: "Claim limits", what: "One refund per product bought, and no more claims than units recalled.", why: "It keeps the refund pool fair for every owner." },
  "check.C6": { title: "Not already refunded", what: "If your PayPal purchase is linked, PayPal is asked whether it was already refunded or is in a dispute.", why: "Each purchase is refunded once." },
  "claim.verified": {
    title: "Verified",
    what: "Every check passed, so the sample firm's auto-approve rule pays the refund now.",
    why: "When a photo shows everything the recall asks for, there is no reason to make you wait.",
    technical: "Verified means C1 to C6 pass and the amount is at or under the firm's auto-approve cap. The payment router then picks a refund to your PayPal purchase (inside 180 days), a safe replacement, or a PayPal payout.",
  },
  "claim.retake": {
    title: "Retake",
    what: "The photo is missing something the recall asks for, or it was hard to see.",
    why: "A new photo is the quickest way to your refund; nothing is wrong with your claim.",
  },
  "claim.review": {
    title: "Firm review",
    what: "A person at the firm looks at the photo and the checks, then approves the refund or asks for another photo.",
    why: "Some photos need a person's eye. Two AI reviewers look first, so the person has the evidence ready.",
    technical: "Firm review follows an unclear check, two reviewers who disagree, or an amount above the auto-approve cap. Each reviewer must cite visible evidence; the referee in code sets aside any vote whose evidence does not check out.",
    sponsor: ["Claude"],
  },
  "claim.route": {
    title: "Where the refund goes",
    what: "To your PayPal account by email or phone, to Venmo, back to your PayPal purchase, or as a safe replacement.",
    why: "You choose the way you already get paid.",
    technical: "PayPal Payouts with recipient_type EMAIL or PHONE (Venmo uses the VENMO wallet on live PayPal; the sandbox sends a PayPal phone payout). A linked capture inside 180 days is refunded with POST /v2/payments/captures/{id}/refund. A replacement is paid with Orders v2.",
    sponsor: ["PayPal"],
  },
  "claim.replacement": {
    title: "Safe replacement",
    what: "A similar product, in stock, at or under your refund amount, that does not match any recall in Remedy's list.",
    why: "Some owners would rather have a working product than money back.",
    technical: "Channel3 product search, then each result is checked against Remedy's recall search. In the sandbox the firm pays the retailer stand-in with Orders v2.",
    sponsor: ["Channel3", "PayPal", "Elastic"],
  },
  "claim.sale": {
    title: "Bought it with PayPal",
    what: "If you bought the sample power bank with PayPal, the refund can go back to that same payment.",
    why: "PayPal refunds a purchase for up to 180 days, so the money returns the way it was paid.",
    technical: "The sample shop's sale is matched by its sale and capture id, or by a keyed hash of your PayPal email. C6 asks PayPal whether the capture was already refunded or disputed.",
    sponsor: ["PayPal"],
  },
  "claim.receipt": {
    title: "Your receipt",
    what: "Where your refund is, updated live from PayPal.",
    why: "You can see the money arrive, and keep this page as your record.",
    technical: "The page asks Remedy every few seconds, and Remedy asks PayPal for the payout item's status. PayPal's webhooks remain the durable path. Every step is in Remedy's hash-chained ledger.",
    sponsor: ["PayPal"],
  },
  "try.presets": {
    title: "Ready-made examples",
    what: "Real photos run through the real checks: the CPSC's own example, an official picture, a blurry photo and an unrelated one.",
    why: "You can see each kind of answer in seconds, without taking a photo.",
    technical: "Checks that need no model run live. Checks that need Claude replay one recorded live answer, so running an example costs nothing; every check around that answer runs again in code.",
  },
  "try.yourphoto": {
    title: "Your photo",
    what: "Pick a recall, add any photo, and see the six checks run live.",
    why: "It is the same path an owner takes.",
    technical: "Live Claude Opus 5.5 vision, within a daily AI budget and a per-visitor limit. Payouts come from the sample firm's PayPal sandbox account.",
    sponsor: ["Claude", "PayPal"],
  },
  "try.anyrecall": {
    title: "Any recall",
    what: "Paste a CPSC recall number or recall page address to see its proof rule.",
    why: "Any recall's remedy can become a checklist and a set of checks.",
    technical: "Recalls in Remedy's list use their stored Claude rule. Others are fetched live from the CPSC API and read with Remedy's keyword rules, labelled a quick read.",
  },
  "try.quickread": {
    title: "Quick read",
    what: "This rule was read with Remedy's keyword rules, not by Claude.",
    why: "It is instant and free, and good enough to show the shape of the rule. A stored Claude rule is more exact.",
  },
  "try.shop": {
    title: "The sample shop",
    what: "Buy Brightline Home's sample power bank with a PayPal sandbox account, then claim it.",
    why: "It shows a verified claim refunded to the original PayPal purchase, inside PayPal's 180-day window.",
    technical: "Orders v2 with the JavaScript SDK v6 button. The capture is stored as a sale; a claim linked to it is refunded with Payments v2. Brightline Home and its power bank are fictional.",
    sponsor: ["PayPal"],
  },
} satisfies Record<string, InfoEntry>;

export type ClaimInfoId = keyof typeof CLAIM_INFO;
