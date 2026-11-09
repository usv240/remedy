// A redacted transcript of a sandbox end-to-end run, for content/public/e2e-transcript.json: each step with its
// result and the time since the run began, the PayPal resource ids and statuses the run saw, and the totals. No
// secrets and no email addresses are written: every email in a detail line is replaced by "<email>", and the only
// identifiers kept are the ones PayPal and Remedy issue (claim ids, payout batch and item ids, refund, order and capture
// ids). Every suite writes into the same file, each under its own name, so the file holds the last run of each.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "content", "public", "e2e-transcript.json");
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/g;
const redact = (s) => String(s ?? "").replace(EMAIL, "<email>");

export function startTranscript(suite, about) {
  const began = Date.now();
  const steps = [];
  const ids = {};
  return {
    /** One check: its name, whether it passed, a short detail (emails removed) and the time since the run began. */
    step(name, ok, detail = "") {
      steps.push({ step: name, ok, at_ms: Date.now() - began, detail: redact(detail).slice(0, 240) });
    },
    /** PayPal and Remedy identifiers and statuses seen along the way, by name; only known keys are kept. */
    ids(more) {
      for (const [k, v] of Object.entries(more ?? {})) {
        if (v === undefined || v === null || v === "") continue;
        if (!/^(claim_ids|payout_batch_id|payout_item_id|payout_status|refund_id|refund_status|order_id|capture_id|sale_id|photo_to_verified_ms|photo_to_completed_ms|approval_to_paid_s|amount|route)$/.test(k)) continue;
        if (k === "claim_ids") ids.claim_ids = [...new Set([...(ids.claim_ids ?? []), ...v])];
        else ids[k] = typeof v === "string" ? redact(v) : v;
      }
    },
    save(totals) {
      let file = { note: "", suites: {} };
      if (existsSync(FILE)) {
        try {
          file = JSON.parse(readFileSync(FILE, "utf8"));
        } catch {
          /* start again */
        }
      }
      file.note =
        "Redacted transcripts of the end-to-end suites run against a local production build with PayPal sandbox keys and a fresh database: each step, the PayPal resource ids and statuses the run saw, and timings. Written by tests/e2e/transcript.mjs from tests/e2e/claim.mjs, tests/e2e/claim-shop.mjs and tests/e2e/try-payout.mjs. No secrets; email addresses are replaced by <email>. Sandbox only: no real money moved.";
      file.suites[suite] = { about, ranAt: new Date(began).toISOString(), base: redactBase(process.env.BASE_URL ?? "http://localhost:3300"), total_ms: Date.now() - began, passed: totals.passed, failed: totals.failed, ids, steps };
      mkdirSync(path.dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(file, null, 2) + "\n");
      return FILE;
    },
  };
}

/** The server's address as "local build" or its public host, never a raw internal address with a port. */
function redactBase(url) {
  try {
    const u = new URL(url);
    return /^(localhost|127\.)/.test(u.hostname) ? "local production build" : u.host;
  } catch {
    return "local production build";
  }
}
