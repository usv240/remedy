/**
 * The public API, as plain data: the playground, the docs page, /openapi.json and the tests all read from here.
 * Client-safe. Plan section 9.
 */
export type Field = { name: string; type: string; about: string; required?: boolean };

export type Endpoint = {
  id: string;
  method: "GET" | "POST";
  path: string;
  title: string;
  summary: string;
  /** JSON body for the playground and the docs example. For a photo upload, the other form fields (recall_number). */
  example?: unknown;
  upload?: boolean;
  /** Form fields sent with the photo, for the docs and OpenAPI. */
  formFields?: Field[];
  ai?: boolean;
  keyed: boolean;
  /** The key scope the endpoint needs: read, verify or payments:sandbox. */
  scope?: "read" | "verify" | "payments:sandbox";
  /** The path the playground calls, with sample values in place of {params}, for example /api/v1/recalls/27056. */
  samplePath?: string;
  /** Query parameters for GET endpoints. The first example values make the playground's request. */
  query?: { name: string; description: string; example?: string; enum?: string[] }[];
  /** Path parameters, by name. */
  params?: { name: string; description: string }[];
  /** What comes back in data, one row per field. */
  responseFields?: Field[];
  /** Served by another part of Remedy (the owner's claim flow); documented here, not in the playground. */
  playground?: boolean;
  /** A plain note shown under the endpoint in the docs. */
  note?: string;
};

const RULE_FIELDS: Field[] = [
  { name: "photo_required", type: "boolean", about: "True when the owner must send a photo to get the remedy." },
  { name: "actions", type: "array of string", about: "What to do to the product first: cut_cord, cut_in_half, write_recalled, remove_part, puncture, disassemble, other." },
  { name: "marker_text", type: "string | null", about: "The exact words to write on the product, for example recalled." },
  { name: "must_show", type: "array of string", about: "What the photo must show: whole_product, label, model_number, serial_or_lot, date_code, cut_or_damage, marking." },
  { name: "remedy", type: "string", about: "What the owner gets: full_refund, partial_refund, replacement, repair, refund_or_replacement, other." },
  { name: "refund_amount", type: "number | null", about: "A fixed dollar amount the remedy states. Null for a full refund of the price paid." },
  { name: "steps", type: "array of string", about: "Up to four plain steps for the owner." },
];

export const ENDPOINTS: Endpoint[] = [
  {
    id: "recalls",
    method: "GET",
    path: "/api/v1/recalls",
    title: "Search recalls",
    summary: "Search US consumer product recalls since 2024 in plain words, or list the newest that fit the filters. Each hit carries its proof rule in short.",
    keyed: true,
    scope: "read",
    query: [
      { name: "query", description: "Plain words, for example power bank or a crib that tips. Leave out to list the newest recalls.", example: "power bank" },
      { name: "photo_refund", description: "true for recalls that offer a refund for a photo of the product made safe; false for the others.", example: "true", enum: ["true", "false"] },
      { name: "year", description: "Recall year, 2024 to 2026." },
      { name: "category", description: "Product type, for example Heaters or Baby and nursery." },
      { name: "remedy", description: "A CPSC remedy option.", enum: ["Refund", "Repair", "Replace", "Dispose", "New Instructions", "Label", "Inspect"] },
      { name: "units", description: "How many units were recalled.", enum: ["under-1k", "1k-10k", "10k-50k", "50k-plus"] },
      { name: "limit", description: "Hits to return, 1 to 100. Default 20. A search with words returns at most 30." },
      { name: "offset", description: "Skip this many hits, for the next page." },
    ],
    responseFields: [
      { name: "total", type: "integer", about: "How many recalls fit. With words, the matches in the reranked top 30." },
      { name: "hits[].number", type: "string", about: "The CPSC recall number." },
      { name: "hits[].title", type: "string", about: "The recall's title as the CPSC published it." },
      { name: "hits[].date", type: "string", about: "Recall date, YYYY-MM-DD." },
      { name: "hits[].photo_refund", type: "boolean", about: "The remedy offers a refund for a photo of the product made safe." },
      { name: "hits[].units", type: "integer | null", about: "US units recalled, as the CPSC states them." },
      { name: "hits[].proof_rule", type: "object | null", about: "The rule in short: actions, marker_text, must_show, remedy, refund_amount, steps." },
      { name: "hits[].score", type: "number | null", about: "Relevance from the reranker. Null when listing." },
      { name: "meta.search.mode", type: "string", about: "elastic (hybrid search), local (the in-app keyword ranking) or list." },
    ],
  },
  {
    id: "recall",
    method: "GET",
    path: "/api/v1/recalls/{number}",
    samplePath: "/api/v1/recalls/27056",
    title: "Get one recall",
    summary: "One recall: its products, official images, hazard, the remedy exactly as published, and its proof rule with confidence per field.",
    keyed: true,
    scope: "read",
    params: [{ name: "number", description: "The CPSC recall number, for example 27056." }],
    responseFields: [
      { name: "remedy_text", type: "string", about: "The official remedy, every paragraph joined, word for word." },
      { name: "hazard", type: "string", about: "The hazard, as the CPSC states it." },
      { name: "images[]", type: "array of objects", about: "Official CPSC images: url, caption, and a local thumbnail where one is stored." },
      { name: "products[]", type: "array of objects", about: "Each product: name, model, type, units_text." },
      { name: "proof_rule", type: "object | null", about: "The full stored rule, with explanation, confidence (actions, must_show, remedy, each 0 to 1), source and model." },
      { name: "claim_page", type: "string", about: "Where an owner starts a claim on Remedy." },
    ],
  },
  {
    id: "proof-rule",
    method: "POST",
    path: "/api/v1/proof-rule",
    title: "Read a proof rule",
    summary: "Turn a recall's remedy into a proof rule: what to cut or mark, what the photo must show, and the refund. Send a recall number for the stored rule, or any remedy text.",
    example: { recall_number: "27056" },
    ai: true,
    keyed: true,
    scope: "verify",
    responseFields: [
      { name: "rule", type: "object", about: "The proof rule. See the fields below." },
      ...RULE_FIELDS.map((f) => ({ ...f, name: `rule.${f.name}` })),
      { name: "rule.confidence", type: "object", about: "How sure the reader is of actions, must_show and remedy, each 0 to 1." },
      { name: "source", type: "string", about: "stored (extracted by Claude in a batch), claude (read just now) or quick (deterministic, no AI)." },
      { name: "lint", type: "array of objects", about: "Mechanical checks the rule must pass against its remedy text. Empty when all pass." },
    ],
    note: 'With remedy_text, the quick reader answers at once with no AI. Add "mode": "claude" and an API key for Claude Opus 5.5 with a self-check, up to 20 a day per key.',
  },
  {
    id: "verify",
    method: "POST",
    path: "/api/v1/verify",
    title: "Verify a photo",
    summary: "Check an owner's photo against a recall's proof rule: right product, made safe, their own photo, within the recall. Returns each check and the decision. Nothing is paid.",
    example: { recall_number: "27056" },
    upload: true,
    formFields: [
      { name: "photo", type: "file", about: "JPEG, PNG or WebP, up to 10 MB.", required: true },
      { name: "recall_number", type: "string", about: "The CPSC recall number the photo is for.", required: true },
      { name: "amount", type: "string", about: "The refund the firm would pay, for example 34.99. Optional; the decision then applies a $50 auto-approve cap." },
    ],
    ai: true,
    keyed: true,
    scope: "verify",
    responseFields: [
      { name: "decision", type: "string", about: "verified, retake (with guidance) or firm_review (a person at the firm looks)." },
      { name: "mode", type: "string", about: "full (every check, with Claude vision) or free (quality and own-photo checks only, no AI). Without a key it is free." },
      { name: "checks.C1 to checks.C6", type: "object", about: "Each check: name, status (pass, fail, unclear, skipped, unavailable), score, a plain reason and a technical one." },
      { name: "guidance", type: "object | null", about: "For a retake: what to change, in plain steps." },
      { name: "summary", type: "object", about: "The decision in one plain sentence and one technical one." },
      { name: "timings", type: "object", about: "Milliseconds for each stage and in total." },
    ],
  },
  {
    id: "claims",
    method: "POST",
    path: "/api/v1/claims",
    title: "Open a claim",
    summary: "Open a claim with the owner's photo. Remedy stores it, runs the six checks and records the decision. Paying is the next call. Sandbox only.",
    upload: true,
    example: { recall: "27056" },
    formFields: [
      { name: "photo", type: "file", about: "JPEG or PNG of the product made safe, up to 15 MB.", required: true },
      { name: "recall", type: "string", about: "The CPSC recall number, for example 27056.", required: true },
      { name: "sale_id", type: "string", about: "The sample-shop purchase to refund, from the shop's receipt. Optional." },
      { name: "capture_id", type: "string", about: "The PayPal capture to refund to, inside 180 days. Optional." },
      { name: "paypal_email", type: "string", about: "Find the sample-shop purchase by the buyer's PayPal email instead. Optional." },
    ],
    ai: true,
    keyed: true,
    scope: "verify",
    playground: false,
    responseFields: [
      { name: "id", type: "string", about: "The claim id (a UUID)." },
      { name: "status, decision", type: "string", about: "Where the claim stands, and the checks' verdict: verified, retake or firm_review." },
      { name: "checks[]", type: "array of objects", about: "C1 to C6, each with its status and plain reason." },
      { name: "amount", type: "object | null", about: "The refund: the firm's amount, or the linked PayPal capture's, whichever is lower." },
      { name: "receipt_url", type: "string", about: "The owner's live receipt page." },
    ],
    note: "Send Accept: text/event-stream to get each stage as it runs (claim, stage, result and error events). The same route as POST /api/claims, which the /claim page uses, with the same limits on live checks.",
  },
  {
    id: "claim",
    method: "GET",
    path: "/api/v1/claims/{id}",
    samplePath: "/api/v1/claims/00000000-0000-0000-0000-000000000000",
    title: "Claim status",
    summary: "Where a claim stands: the six checks, the decision, and the payment with its PayPal status. The payee is masked.",
    keyed: true,
    scope: "read",
    params: [{ name: "id", description: "The claim id returned when it was opened." }],
    query: [{ name: "refresh", description: "1 asks PayPal for the payment's latest status first.", enum: ["1"] }],
    playground: false,
    responseFields: [
      { name: "payment.status_plain", type: "string | null", about: "Where the money is, in plain words." },
      { name: "payment.paypal_status", type: "string | null", about: "PayPal's own word for it, for example SUCCESS or UNCLAIMED." },
      { name: "payment.ids", type: "object", about: "The PayPal payout batch, item, refund, order and capture ids." },
    ],
    note: "The same route as GET /api/claims/{id}.",
  },
  {
    id: "pay",
    method: "POST",
    path: "/api/v1/claims/{id}/pay",
    samplePath: "/api/v1/claims/00000000-0000-0000-0000-000000000000/pay",
    title: "Pay a claim",
    summary: "Say where the refund goes, then pay it in the PayPal sandbox: a payout to PayPal or Venmo, a refund to the original PayPal purchase inside 180 days, or a safe replacement.",
    example: { choice: "money", payee_type: "email", payee: "jordan@example.com" },
    keyed: true,
    scope: "payments:sandbox",
    params: [{ name: "id", description: "The claim id." }],
    playground: false,
    formFields: [
      { name: "choice", type: '"money" | "replacement"', about: "money (with payee_type and payee) or replacement (with replacement_id). Default money." },
      { name: "payee_type", type: '"email" | "phone" | "venmo"', about: "Where a money refund goes. Venmo falls back to a PayPal phone payout in the sandbox." },
      { name: "payee", type: "string", about: "The owner's PayPal email or phone number. Stored encrypted; shown masked." },
      { name: "replacement_id", type: "string", about: "A product id from the replacements call." },
    ],
    responseFields: [{ name: "payment", type: "object", about: "The plan and the payment: route, amount, approval, and PayPal's status." }],
    note: "A linked purchase is refunded to its capture and needs no payee. The firm's auto rule pays a verified claim at or under its cap at once; anything else waits for a person at the firm. A second call never pays twice. The same route as POST /api/claims/{id}/pay.",
  },
  {
    id: "replacements",
    method: "GET",
    path: "/api/v1/claims/{id}/replacements",
    samplePath: "/api/v1/claims/00000000-0000-0000-0000-000000000000/replacements",
    title: "Safe replacements",
    summary: "Products a verified owner can choose instead of money, found by Channel3, each checked against active recalls first.",
    keyed: true,
    scope: "read",
    params: [{ name: "id", description: "The claim id." }],
    playground: false,
    note: "The same route as GET /api/claims/{id}/replacements.",
  },
  {
    id: "ledger",
    method: "GET",
    path: "/api/ledger/verify",
    title: "Verify the ledger",
    summary: "Recompute the audit ledger's SHA-256 hash chain from the first entry and report whether every entry still matches.",
    keyed: false,
  },
  {
    id: "health",
    method: "GET",
    path: "/api/health",
    title: "Service status",
    summary: "Whether PayPal, Claude, the database and each sponsor tool are live, on a fallback, or not connected right now.",
    keyed: false,
  },
];

export const ERRORS = [
  { code: "invalid_request", status: "400, 409, 413, 422", plain: "Something in the request is missing or not valid. The message says what; details lists each field." },
  { code: "unauthorized", status: "401", plain: "The API key is not valid or was revoked, or the call needs a key. Create a new key on the Developers page." },
  { code: "not_found", status: "404", plain: "The thing you asked for does not exist, such as an unknown recall or claim." },
  { code: "rate_limited", status: "429", plain: "Too many requests. Wait for the time in the Retry-After header. Keys allow 60 a minute and 1,000 a day." },
  { code: "upstream_unavailable", status: "502, 503", plain: "PayPal or the AI service did not answer, or is not connected on this server. The message says which." },
  { code: "internal", status: "500", plain: "Something went wrong on our side. The request id in meta helps us find it." },
] as const;

/** The MCP server's tools, for the docs and llms.txt (the server itself is src/lib/mcp/tools.ts). */
export const MCP_URL_PATH = "/api/mcp";
