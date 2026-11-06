// The sample-shop path end to end in the PayPal sandbox, fully automatic: buy Brightline Home's sample 65W charger
// ($34.99), claim it on Brightline's own sample recall BH-2026-01 with the sale linked and the photo of the charger
// with its cord cut (public domain, Dmitry G, Wikimedia Commons), see it verified, and see the firm's auto rule refund
// $34.99 to the original capture at once, with no person. The verification is answered by the verify cache
// (precomputed by scripts/verify/precompute.ts from one recorded live run), so the suite makes no Claude call.
// Needs the server at BASE_URL and Chrome for the sandbox buyer login.
//   npx tsx --env-file=.env.local tests/e2e/claim-shop.mjs [--keep]
import { readFileSync } from "node:fs";
import pg from "pg";
import { approveAsBuyer } from "../../scripts/payments/approve-as-buyer.ts";

const B = process.env.BASE_URL ?? "http://localhost:3300";
const SECRET = process.env.CHECKS_SECRET ?? "";
const keep = process.argv.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
};
const made = { claims: [], sale: null };
const post = async (path, body, headers = {}) => {
  const r = await fetch(B + path, { method: "POST", body, headers });
  return { status: r.status, j: await r.json().catch(() => null) };
};

const RECALL = "BH-2026-01";
const PHOTO = "content/verify/fixtures/sample/cord-cut.jpg";

function claimForm(sale) {
  const fd = new FormData();
  fd.set("recall", RECALL);
  fd.set("photo", new Blob([readFileSync(PHOTO)], { type: "image/jpeg" }), "cord-cut.jpg");
  fd.set("sale_id", String(sale.sale_id));
  fd.set("capture_id", sale.capture_id);
  return fd;
}

async function main() {
  if (!SECRET) throw new Error("CHECKS_SECRET is not set; run with --env-file=.env.local");
  const order = await post("/api/shop/orders", JSON.stringify({ return_path: "/try/shop" }), { "Content-Type": "application/json" });
  check("sample shop order created", order.status === 200 && Boolean(order.j?.data?.approve_url), order.j?.data?.id);
  await approveAsBuyer(order.j.data.approve_url, `${B}/try/shop`);
  const cap = await post(`/api/shop/orders/${order.j.data.id}/capture`);
  const sale = cap.j?.data;
  made.sale = sale?.sale_id ?? null;
  check("purchase captured and stored as a sale", cap.status === 200 && Boolean(sale?.capture_id), `capture ${sale?.capture_id}, sale ${sale?.sale_id}, $${sale?.amount}`);

  const tPhoto = Date.now();
  const c = await post("/api/claims", claimForm(sale), { "x-checks-secret": SECRET });
  const claim = c.j?.data;
  const tVerified = Date.now();
  if (claim?.id) made.claims.push(claim.id);
  check("the claim links the purchase", claim?.link?.status === "linked" && claim.link.amount === sale.amount, JSON.stringify(claim?.link));
  check(
    "verified: right charger, cord cut, own photo (answered by the verify cache, no Claude call)",
    claim?.decision === "verified",
    `${claim?.decision} by ${claim?.decided_by}; ${claim?.checks?.map((x) => `${x.id} ${x.status}`).join(", ")}; ${tVerified - tPhoto} ms; ${claim?.summary?.technical?.includes("verification cache") ? "cache hit" : "no cache hit"}`,
  );
  check("C6 asks PayPal about the capture: no earlier refund or dispute", claim?.checks?.find((x) => x.id === "C6")?.status === "pass", claim?.checks?.find((x) => x.id === "C6")?.reason_technical);
  check("the refund is the lower of the firm's $34.99 and the purchase", claim?.amount?.value === "34.99", claim?.amount?.value);

  const plan = await post(`/api/claims/${claim.id}/pay`, JSON.stringify({ choice: "money" }), { "Content-Type": "application/json" });
  check("no payee needed: the router picks a refund to the original capture", plan.status === 200 && plan.j?.data?.claim?.payment?.route === "refund", plan.j?.data?.claim?.payment?.reasons?.plain ?? plan.j?.error?.message);
  check("the firm's auto rule approves it ($34.99 is under the $50.00 cap) and the refund is sent, with no person", plan.j?.data?.kind === "sent", `${plan.j?.data?.kind}: ${plan.j?.data?.plain}`);
  let view = plan.j?.data?.claim;
  while (view?.payment?.status !== "paid" && Date.now() - tPhoto < 120_000) {
    await sleep(2000);
    view = (await (await fetch(`${B}/api/claims/${claim.id}?refresh=1`)).json()).data ?? view;
  }
  const tPaid = Date.now();
  check(
    "PayPal completes the refund to the capture",
    view?.payment?.status === "paid" && Boolean(view?.payment?.ids?.refund_id),
    `refund ${view?.payment?.ids?.refund_id}; photo to verified ${((tVerified - tPhoto) / 1000).toFixed(1)} s, photo to PayPal COMPLETED ${((tPaid - tPhoto) / 1000).toFixed(1)} s`,
  );
  const receipt = await (await fetch(`${B}/r/${claim.id}`)).text();
  check("the receipt says Refunded $34.99 to your PayPal payment", receipt.includes("Refunded $34.99 to your PayPal payment") && receipt.includes("Sandbox refund ID"));

  const again = await post("/api/claims", claimForm(sale), { "x-checks-secret": SECRET });
  if (again.j?.data?.id) made.claims.push(again.j.data.id);
  check("the same purchase cannot be linked to a second claim", again.j?.data?.link?.status === "already_claimed", again.j?.data?.link?.message);
}

main()
  .catch((e) => {
    console.error("shop e2e failed:", e.message);
    fail++;
  })
  .finally(async () => {
    if (!keep && process.env.DATABASE_URL) {
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      for (const id of made.claims) {
        const { rows } = await c.query("select photo_id from claim where id = $1", [id]);
        await c.query("delete from plan_task where data->>'claimId' = $1", [id]);
        await c.query("delete from claim where id = $1", [id]);
        if (rows[0]?.photo_id) {
          await c.query("delete from image_hash where source = 'claim' and ref = $1", [rows[0].photo_id]);
          await c.query("delete from photo where id = $1", [rows[0].photo_id]);
        }
      }
      if (made.sale && /^\d+$/.test(String(made.sale))) await c.query("delete from sale where id = $1", [Number(made.sale)]);
      await c.end();
      console.log(`removed ${made.claims.length} test claims and the test sale (ledger entries stay)`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
