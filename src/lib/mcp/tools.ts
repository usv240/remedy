import { z } from "zod";
import { API_VERSION } from "@/lib/api/envelope";
import { findRecalls, recallByNumber, storedRule, summarize } from "@/lib/api/recall-data";
import { actionLabel, remedyLabel, ruleChips } from "@/lib/api/rule-chips";
import { VERIFY_LIMITS } from "@/lib/api/v1-schemas";
import { VerifyInputError, sha256, verifyBody, verifyForApi, verifyMode } from "@/lib/api/verify-service";
import { extractBaseline } from "@/lib/recall/proof-rule";
import { SCAN_LIMITS, scanCatalog } from "@/lib/recall/scan";
import { isFetchableUrl, normalizeImageUrl } from "@/lib/verify/official";

/**
 * The Remedy MCP server's tools (plan section 9). Each is a Zod input schema plus a handler that returns plain text for
 * the model and structured data for programs. The claim tools call the owner's claim routes on this same server, so
 * an agent and the /claim page open claims the same way.
 */

/** What a tool returns: plain text for the model, structured data for programs. */
export type ToolResult = { text: string; data?: Record<string, unknown>; isError?: boolean };
/** origin: this server's public address. keyId: the API key behind the call, when one was sent. auth: its header, passed on to the claim routes. */
export type Ctx = { origin: string; keyId?: number | null; auth?: string | null };
type Tool<S extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  /** For a tool that changes something: what it changes, in plain words. */
  changes?: string;
  run: (input: z.infer<S>, ctx: Ctx) => Promise<ToolResult>;
};
const tool = <S extends z.ZodType>(t: Tool<S>) => t;

const recallNumber = z.string().min(4).max(40).describe('The CPSC recall number, for example "27056".');
const image = {
  image_url: z.url().max(2000).optional().describe("A public https link to the photo (JPEG, PNG or WebP)."),
  image_base64: z.string().max(14_000_000).optional().describe("The photo itself, base64-encoded, with or without a data: prefix."),
};

/** The photo's bytes from a link or from base64, at most 10 MB. */
async function photoFrom(i: { image_url?: string; image_base64?: string }): Promise<{ bytes: Uint8Array; mime?: string } | string> {
  if (i.image_base64) {
    const m = /^data:([\w/+.-]+);base64,/.exec(i.image_base64);
    const bytes = Buffer.from(i.image_base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""), "base64");
    if (!bytes.byteLength) return "image_base64 did not decode to a photo.";
    return { bytes, mime: m?.[1] };
  }
  if (i.image_url) {
    if (!isFetchableUrl(i.image_url)) return "image_url must be a public http or https link.";
    try {
      const res = await fetch(normalizeImageUrl(i.image_url), { headers: { Accept: "image/*", "User-Agent": "Remedy/1.0 (recall photo verification)" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return `The photo link answered ${res.status}.`;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > VERIFY_LIMITS.maxBytes) return "The photo is larger than 10 MB.";
      return { bytes, mime: res.headers.get("content-type") ?? undefined };
    } catch {
      return "The photo link could not be opened.";
    }
  }
  return "Send the photo as image_url or image_base64.";
}

const claimLinkText = (n: string, origin: string, title: string, steps: string[]) =>
  `To claim the refund for recall ${n} (${title}), the owner opens ${origin}/claim/${n}, follows ${steps.length ? `these steps: ${steps.join(" ")}` : "the checklist"}, and takes one photo. They choose where the refund goes. Demonstration in PayPal sandbox; Remedy is not affiliated with the recalling firm.`;

/** Calls the owner's claim routes on this server. A route that is not there yet answers 404, said plainly. */
async function claimRoute(ctx: Ctx, path: string, init: RequestInit = {}) {
  const res = await fetch(`${ctx.origin}${path}`, { ...init, headers: { ...(ctx.auth ? { Authorization: ctx.auth } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; error?: { message?: string } } | null;
  return { status: res.status, body };
}

export const TOOLS = [
  tool({
    name: "ping",
    title: "Check the connection",
    description: "Confirms the Remedy MCP server is reachable and says which API version it serves. Changes nothing.",
    input: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (_input, ctx) => ({
      text: `Remedy is reachable at ${ctx.origin}. API version ${API_VERSION}. Sandbox only.`,
      data: { ok: true, origin: ctx.origin, version: API_VERSION },
    }),
  }),

  tool({
    name: "search_recalls",
    title: "Search recalls",
    description:
      "Finds US consumer product recalls since 2024 from plain words, for example \"power bank\" or \"crib that tips over\". Each result says whether the recall pays a refund for a photo of the product made safe, and what to do. Changes nothing.",
    input: z.object({
      query: z.string().min(2).max(200).describe("What the product is, in plain words."),
      photo_refund: z.boolean().optional().describe("True for only the recalls that refund a photo of the product made safe."),
      limit: z.number().int().min(1).max(10).default(5).describe("How many results, 1 to 10."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (i, ctx) => {
      const r = await findRecalls({ query: i.query, filters: { photoRefund: i.photo_refund }, limit: i.limit });
      if (!r.hits.length) return { text: `No recalls since 2024 match "${i.query}". Try other words for the product, or its brand.`, data: { query: i.query, hits: [] } };
      const lines = r.hits.map((h, n) => {
        const chips = h.proof_rule ? ruleChips(h.proof_rule).join(", ") : "no proof rule stored";
        return `${n + 1}. Recall ${h.number}, ${h.date}: ${h.title}. ${h.photo_refund ? `Photo refund: ${chips}.` : `Remedy: ${h.remedies.join(", ") || "see the recall"}.`} ${ctx.origin}${h.page}`;
      });
      return { text: `${r.hits.length} recalls for "${i.query}" (${r.mode} search):\n${lines.join("\n")}`, data: { query: i.query, mode: r.mode, hits: r.hits } };
    },
  }),

  tool({
    name: "scan_catalog",
    title: "Scan a catalog",
    description:
      "Checks a list of products (name, with model, SKU or brand when known) against every CPSC recall since 2024 at once. Each row comes back photo_refund (a recall pays for a photo of it made safe, with the claim link), recalled (a recall with another remedy), clear or unknown. Changes nothing.",
    input: z.object({
      items: z
        .array(z.object({ name: z.string().min(1).max(200), model: z.string().max(80).optional(), sku: z.string().max(80).optional(), brand: z.string().max(80).optional() }))
        .min(1)
        .max(SCAN_LIMITS.freeItems)
        .describe(`The products, up to ${SCAN_LIMITS.freeItems} at a time.`),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (i, ctx) => {
      const r = await scanCatalog(i.items);
      const s = r.summary;
      const lines = r.results.map((x) => `${x.row}. ${x.item.name}: ${x.status.replace("_", " ")}${x.recall ? ` (recall ${x.recall.number}, ${x.recall.remedy_summary}${x.claim_url ? `; claim at ${ctx.origin}${x.claim_url}` : ""})` : ""}. ${x.reason}`);
      const results = r.results.map((x) => ({ ...x, claim_url: x.claim_url ? `${ctx.origin}${x.claim_url}` : null }));
      return { text: `${s.total} rows: ${s.photo_refund} photo refund, ${s.recalled} recalled, ${s.clear} clear, ${s.unknown} unknown. ${r.ai.note}\n${lines.join("\n")}`, data: { summary: s, results, ai: r.ai } };
    },
  }),

  tool({
    name: "get_proof_rule",
    title: "Get a recall's proof rule",
    description:
      "Reads one recall's remedy as a proof rule: what to cut or mark on the product, what the photo must show, and the refund, with the official remedy text it came from. Changes nothing.",
    input: z.object({ recall_number: recallNumber }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (i, ctx) => {
      const recall = recallByNumber(i.recall_number);
      if (!recall) return { text: `There is no recall ${i.recall_number} in Remedy's data, which covers CPSC recalls since January 2024. search_recalls can find it by product.`, isError: true };
      const stored = storedRule(recall.number);
      const rule = stored?.rule ?? extractBaseline(recall);
      const todo = rule.actions.map((a) => actionLabel(a, rule)).join(", ") || "nothing to cut or mark";
      const text = [
        `Recall ${recall.number}: ${recall.title}.`,
        rule.photo_required ? `It pays on a photo. First: ${todo}. Remedy: ${remedyLabel(rule.remedy)}${rule.refund_amount ? ` of $${rule.refund_amount}` : ""}.` : `It does not ask for a photo. Remedy: ${remedyLabel(rule.remedy)}.`,
        rule.steps.length ? `Steps: ${rule.steps.join(" ")}` : "",
        `Official remedy: "${recall.remedyText.slice(0, 600)}${recall.remedyText.length > 600 ? "..." : ""}"`,
        `Source: ${stored ? `stored rule, ${stored.model}` : "quick read, no AI"}. Details: ${ctx.origin}/recalls/${recall.number}`,
      ]
        .filter(Boolean)
        .join("\n");
      return { text, data: { recall_number: recall.number, title: recall.title, rule, source: stored ? "stored" : "quick", remedy_text: recall.remedyText } };
    },
  }),

  tool({
    name: "verify_photo",
    title: "Verify a photo",
    description:
      "Checks an owner's photo against a recall's proof rule: right product, made safe, their own photo, within the recall. Returns each check and the decision (verified, retake or firm_review). Without an API key no model is called: the free checks run, and a photo checked before is answered from the verification cache. Stores nothing and pays nothing.",
    input: z.object({ recall_number: recallNumber, ...image }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: async (i, ctx) => {
      const photo = await photoFrom(i);
      if (typeof photo === "string") return { text: photo, isError: true };
      const { mode, note } = await verifyMode(ctx.keyId ?? null, "mcp");
      try {
        const v = await verifyForApi({ photo: photo.bytes, mime: photo.mime, recallNumber: i.recall_number, mode });
        const body = verifyBody(v, mode, note, sha256(photo.bytes));
        const checks = Object.entries(body.checks)
          .map(([id, c]) => `${id} ${c.name}: ${c.status}. ${c.reason}`)
          .join("\n");
        const head = body.decision === "verified" ? "Verified." : body.decision === "retake" ? `Retake. ${body.guidance?.plain ?? ""}` : `Firm review. ${body.summary.plain}`;
        return { text: `${head}\n${checks}\n${note}`, data: body as unknown as Record<string, unknown> };
      } catch (e) {
        if (e instanceof VerifyInputError) return { text: e.message, isError: true };
        throw e;
      }
    },
  }),

  tool({
    name: "open_claim",
    title: "Open a claim",
    description:
      "Starts a refund claim for a recall. With only the recall number it returns the owner's own claim link and checklist, and changes nothing. With the owner's photo it opens the claim and runs the six checks; the owner then chooses where the refund goes on their receipt page. This tool never pays.",
    input: z.object({ recall_number: recallNumber, ...image }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    changes: "With a photo, opens a claim in the recalling firm's queue (sandbox). Nothing is paid by this tool.",
    run: async (i, ctx) => {
      const recall = recallByNumber(i.recall_number);
      if (!recall) return { text: `There is no recall ${i.recall_number} in Remedy's data.`, isError: true };
      const rule = storedRule(recall.number)?.rule ?? extractBaseline(recall);
      const link = `${ctx.origin}/claim/${recall.number}`;
      if (!i.image_url && !i.image_base64) {
        return { text: claimLinkText(recall.number, ctx.origin, recall.title, rule.steps), data: { recall_number: recall.number, claim_link: link, steps: rule.steps, proof_rule: summarize(rule), opened: false } };
      }
      const photo = await photoFrom(i);
      if (typeof photo === "string") return { text: photo, isError: true };
      const form = new FormData();
      form.append("photo", new Blob([Buffer.from(photo.bytes)], { type: photo.mime ?? "image/jpeg" }), "photo.jpg");
      form.append("recall", recall.number);
      // The same route the /claim page and POST /api/v1/claims use, with the same limits on live checks.
      const r = await claimRoute(ctx, "/api/claims", { method: "POST", body: form });
      if (r.status >= 400 || !r.body?.data) return { text: r.body?.error?.message ?? `The claim was not opened (${r.status}). The owner can open it at ${link}.`, isError: true, data: { claim_link: link } };
      const d = r.body.data as Record<string, unknown> & { id?: string; decision?: string; status?: string; receipt_url?: string; summary?: { plain?: string } | null };
      const receipt = d.receipt_url ? (String(d.receipt_url).startsWith("http") ? String(d.receipt_url) : `${ctx.origin}${d.receipt_url}`) : null;
      return {
        text: `Claim ${d.id ?? ""} opened for recall ${recall.number}. Decision: ${d.decision ?? d.status ?? "checking"}. ${d.summary?.plain ?? ""} ${receipt ? `The owner chooses where the refund goes at ${receipt}.` : ""} Follow it with claim_status. Demonstration in PayPal sandbox; Remedy is not affiliated with the recalling firm.`.replace(/\s+/g, " ").trim(),
        data: d,
      };
    },
  }),

  tool({
    name: "claim_status",
    title: "Claim status",
    description: "Says where a claim stands: the checks, the decision, and the payment with its PayPal status. Changes nothing.",
    input: z.object({ claim_id: z.uuid().describe("The claim id from open_claim.") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: async (i, ctx) => {
      const r = await claimRoute(ctx, `/api/claims/${encodeURIComponent(i.claim_id)}?refresh=1`);
      if (r.status === 404) return { text: `There is no claim ${i.claim_id}.`, isError: true };
      if (r.status >= 400 || !r.body?.data) return { text: r.body?.error?.message ?? `The claim could not be read (${r.status}).`, isError: true };
      const d = r.body.data as Record<string, unknown> & {
        status?: string;
        decision?: string;
        summary?: { plain?: string } | null;
        amount?: { value?: string } | null;
        receipt_url?: string;
        payment?: { status_plain?: string | null; status_label?: string | null; paypal_status?: string | null; amount?: string } | null;
      };
      const pay = d.payment ? ` Payment: ${d.payment.status_plain ?? d.payment.status_label ?? "planned"}${d.payment.paypal_status ? ` (PayPal ${d.payment.paypal_status})` : ""}.` : "";
      // Verified, with a refund and nothing paid yet: the claim is ready to pay, and the owner's choice of where the money goes is the one step left.
      const receipt = d.receipt_url ? (String(d.receipt_url).startsWith("http") ? String(d.receipt_url) : `${ctx.origin}${d.receipt_url}`) : null;
      const ready = d.status === "verified" && !d.payment && d.amount?.value ? ` Ready to pay: $${d.amount.value} through PayPal, once the owner chooses where the refund goes${receipt ? ` at ${receipt}` : ""}.` : "";
      return { text: `Claim ${i.claim_id}: ${d.status ?? d.decision ?? "unknown"}. ${d.summary?.plain ?? ""}${ready}${pay} Sandbox.`.replace(/\s+/g, " ").trim(), data: d };
    },
  }),
];

export const SERVER_INFO = { name: "remedy", title: "Remedy", version: "2026.11.5" };
export const INSTRUCTIONS =
  "Remedy pays recall refunds the moment a photo of the product made safe is verified, through PayPal. It reads public CPSC recall data since 2024. Use search_recalls to find a recall by product, scan_catalog to check a whole list of products at once, get_proof_rule to see what the owner must do and photograph, verify_photo to check a photo, and open_claim to start a claim (with only a recall number it returns the owner's own claim link). The owner always chooses where the refund goes. Sandbox only: no real money moves. Remedy is independent and not affiliated with the CPSC or any recalling firm.";
