// The firm console end to end, in a real browser against a running Remedy with a database:
//   1. the claims queue loads (API and AG Grid), and a claim's drawer opens with its six checks;
//   2. bulk "Approve and pay" on the two seeded claims ready to pay sends real $34.99 PayPal sandbox payouts
//      (skip with FIRM_E2E_PAY=0; then step 4 uses a sample claim instead);
//   3. the monthly report's numbers match the same counts made directly in SQL;
//   4. the Gantt shows a "Re-notice" task, without a reload, after a seeded UNCLAIMED event
//      (scripts/payments/seed-event.ts, the same recordStatus path a PayPal webhook uses).
// Seed first: npx tsx --env-file=.env.local scripts/seed-firm.ts
// Usage: BASE_URL=http://localhost:3300 node --env-file=.env.local tests/e2e/firm.mjs
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE_URL ?? "http://localhost:3300";
const PAY = process.env.FIRM_E2E_PAY !== "0";
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (q, args = []) => (await db.query(q, args)).rows[0];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 1. The queue and the drawer
const api = await (await fetch(`${B}/api/firm/claims`)).json();
const claims = api.data?.claims ?? [];
check("queue API lists the firm's claims", claims.length >= 30, `${claims.length} claims`);
const ready = claims.filter((c) => c.payable && c.sample && c.amountCents === 3499);
check("two seeded claims are ready to pay at $34.99", ready.length >= 2, `${ready.length} ready`);

await page.goto(`${B}/firm/claims`, { waitUntil: "networkidle" });
await page.waitForSelector(".ag-row", { timeout: 60_000 });
const rowCount = new Set(await page.locator(".ag-row[row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("row-id")))).size;
check("AG Grid renders claim rows", rowCount > 5, `${rowCount} rows in view`);
await page.locator(".ag-row .cq-open").first().click();
await page.waitForSelector(".cq-drawer[open] .cq-check-list li", { timeout: 30_000 });
const checksShown = await page.locator(".cq-drawer[open] .cq-check-list li").count();
check("the drawer opens with the six checks", checksShown === 6, `${checksShown} checks`);
const drawerTitle = await page.locator("#cq-drawer-title").textContent();
check("the drawer names the claimant, masked", /^Claim from (.+•••|No contact)/.test(drawerTitle ?? ""), drawerTitle ?? "");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape closes the drawer", (await page.locator(".cq-drawer[open]").count()) === 0);

// The look-alike: the recorded Two reviewers result shows in its drawer.
const look = claims.find((c) => c.recallNumber === "26754" && c.photoUrl && c.sample);
if (look) {
  await page.getByRole("button", { name: "Needs review" }).click();
  await page.locator(`.ag-row[row-id="${look.id}"] .cq-open`).click();
  await page.waitForSelector(".cq-drawer[open] #cq-review", { timeout: 30_000 });
  const reviewers = await page.locator(".cq-drawer[open] .cq-reviewer").count();
  check("the look-alike shows the Two reviewers", reviewers === 2, `${reviewers} reviewers`);
  await page.keyboard.press("Escape");
}

// 2. Bulk approve and pay the two ready claims (real $34.99 sandbox payouts)
let paidClaim = null;
if (PAY && ready.length >= 2) {
  const ids = ready.slice(0, 2).map((c) => c.id);
  await page.goto(`${B}/firm/claims?view=ready`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ag-row", { timeout: 60_000 });
  for (const id of ids) await page.locator(`.ag-row[row-id="${id}"] input[type=checkbox]`).first().check();
  await page.getByTestId("approve-and-pay").click();
  await page.waitForFunction(() => /payouts? sent/.test(document.querySelector(".cq-bulk .firm-status")?.textContent ?? ""), null, { timeout: 90_000 });
  const statusText = await page.locator(".cq-bulk .firm-status").textContent();
  check("bulk Approve and pay sends one PayPal batch", /2 payouts sent in PayPal batch \w+/.test(statusText ?? ""), statusText ?? "");
  const rows = (await db.query(`select claim_id, status, paypal_batch_id, amount::text from payment where claim_id = any($1::uuid[]) order by id`, [ids])).rows;
  check("both payments are recorded with the same PayPal batch", rows.length === 2 && rows[0].paypal_batch_id && rows[0].paypal_batch_id === rows[1].paypal_batch_id, rows.map((r) => `${r.status} ${r.amount}`).join(", "));
  const task = await one(`select name from plan_task where ref = $1`, [`payout-batch:${rows[0]?.paypal_batch_id}`]);
  check("the payments engine added the payout batch to the plan", Boolean(task), task?.name ?? "");
  // The live feed asks PayPal while a payout is on its way; the sandbox usually says SUCCESS within a minute.
  let paid = 0;
  for (let i = 0; i < 30 && paid < 2; i++) {
    await page.waitForTimeout(3000);
    paid = Number((await one(`select count(*) from payment where claim_id = any($1::uuid[]) and status = 'success'`, [ids])).count);
  }
  check("both payouts reach SUCCESS (live status)", paid === 2, `${paid} of 2 paid`);
  paidClaim = ids[0];
} else console.log(PAY ? "skip bulk pay: fewer than two claims ready (run scripts/seed-firm.ts)" : "skip bulk pay: FIRM_E2E_PAY=0");

// 3. The report's numbers match SQL
const month = new Date().toISOString().slice(0, 7);
const rep = await (await fetch(`${B}/api/firm/reports?month=${month}`)).json();
const n = rep.data?.numbers;
check("the report answers for this month", Boolean(n), month);
if (n) {
  const s = `${n.period.start}T00:00:00Z`;
  const e = new Date(Date.parse(`${n.period.through}T00:00:00Z`) + 86_400_000).toISOString();
  const firm = await one(`select id from firm where is_sample order by id limit 1`);
  const sqlCounts = await one(
    `select
       (select count(*) from claim where firm_id = $1 and recall_number = $2 and created_at >= $3 and created_at < $4)::int as received,
       (select count(*) from payment p join claim c on c.id = p.claim_id where c.firm_id = $1 and c.recall_number = $2 and p.route = 'payout' and p.status = 'success' and p.paid_at >= $3 and p.paid_at < $4)::int
         + (select count(*) from payment p join claim c on c.id = p.claim_id where c.firm_id = $1 and c.recall_number = $2 and p.route = 'refund' and p.status = 'refunded' and p.paid_at >= $3 and p.paid_at < $4)::int as refunds,
       (select coalesce(sum(p.amount), 0) from payment p join claim c on c.id = p.claim_id where c.firm_id = $1 and c.recall_number = $2 and ((p.route = 'payout' and p.status = 'success') or (p.route = 'refund' and p.status = 'refunded')) and p.paid_at >= $3 and p.paid_at < $4)::text as refunds_usd,
       (select coalesce(sum(units_claimed), 0) from claim where firm_id = $1 and recall_number = $2 and ((decision = 'verified' and coalesce(review_outcome, '') not in ('retake', 'declined') and coalesce(decided_at, created_at) < $4) or (review_outcome = 'approved' and coalesce(reviewed_at, decided_at, created_at) < $4)))::int as corrected`,
    [firm.id, n.recallNumber, s, e],
  );
  check("claims received match SQL", n.claimsReceived === sqlCounts.received, `${n.claimsReceived} vs ${sqlCounts.received}`);
  check("refunds paid match SQL", n.refundsPaidCount === sqlCounts.refunds && n.refundsPaidCents === Math.round(Number(sqlCounts.refunds_usd) * 100), `${n.refundsPaidCount} (${n.refundsPaidCents}c) vs ${sqlCounts.refunds} (${sqlCounts.refunds_usd})`);
  check("cumulative corrections match SQL", n.correctionsCumulative === sqlCounts.corrected, `${n.correctionsCumulative} vs ${sqlCounts.corrected}`);
  const csv = await (await fetch(`${B}/api/firm/reports?month=${month}&format=csv`)).text();
  check("the CSV carries the same figures", csv.includes(`refunds_paid_count,,${n.refundsPaidCount}`) && csv.includes(`corrections_cumulative,With Consumers: Total Cumulative Corrections for Recall,${n.correctionsCumulative}`));
  await page.goto(`${B}/firm/reports?month=${month}`, { waitUntil: "networkidle" });
  check("the report page shows the same refunds", (await page.getByTestId("rp-refunds").textContent())?.trim() === String(n.refundsPaidCount));
}

// 4. The Gantt gains a Re-notice task live after an UNCLAIMED event
const target =
  paidClaim ??
  (await one(`select c.id from claim c join payment p on p.claim_id = c.id where c.is_sample and p.status = 'success' and p.paypal_status = 'SAMPLE' order by c.created_at desc limit 1`))?.id;
await page.goto(`${B}/firm/plan`, { waitUntil: "networkidle" });
await page.waitForSelector(".plan-gantt .b-gantt-task", { timeout: 90_000 });
await page.waitForFunction(() => /Live:/.test(document.querySelector(".plan-live")?.textContent ?? ""), null, { timeout: 30_000 });
const before = await page.locator(".plan-gantt .b-grid-row", { hasText: "Re-notice: payout waiting to be accepted" }).count();
const seeded = spawnSync(process.execPath, ["--import", "tsx", "scripts/payments/seed-event.ts", "--claim", target, "--status", "unclaimed"], { encoding: "utf8", env: process.env, shell: false });
console.log(`     seed-event: ${(seeded.stdout || seeded.stderr).trim()}`);
await page.waitForSelector('[data-testid="plan-fresh"]', { timeout: 30_000 }).catch(() => null);
const fresh = (await page.locator('[data-testid="plan-fresh"]').textContent().catch(() => "")) ?? "";
check("the Gantt announces the new Re-notice without a reload", /Re-notice/.test(fresh), fresh.slice(0, 120));
const after = await page.locator(".plan-gantt .b-grid-row", { hasText: "Re-notice: payout waiting to be accepted" }).count();
check("the Re-notice row is in the Gantt", after > before, `${before} then ${after}`);
const dep = await one(`select t.dependencies from plan_task t where t.ref = $1`, [`re-notice:${(await one(`select request_id from payment where claim_id = $1 order by id desc limit 1`, [target]))?.request_id}:unclaimed`]);
check("it is linked to its batch when the payout was real", paidClaim ? Array.isArray(dep?.dependencies) && dep.dependencies.length === 1 : true, JSON.stringify(dep?.dependencies ?? null));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
await db.end();
console.log(failed ? `\n${failed} firm checks failed` : "\nall firm checks pass");
process.exitCode = failed ? 1 : 0;
