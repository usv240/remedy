// Records one real response for each public endpoint, for the API docs (content/public/api-examples.json).
// Needs a running Remedy. No AI call: verify runs without a key (free checks only), proof-rule reads a stored rule.
// Usage: BASE_URL=http://localhost:3300 node scripts/public/api-examples.mjs
import { readFileSync, writeFileSync } from "node:fs";

const B = process.env.BASE_URL ?? "http://localhost:3300";
const trimHits = (j, n) => ({ ...j, data: { ...j.data, hits: j.data.hits.slice(0, n) } });
const clip = (s, n) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}...` : s);

const out = {};
async function rec(id, req, path, init, shape = (j) => j) {
  const t = Date.now();
  const r = await fetch(B + path, init);
  const j = await r.json();
  out[id] = { request: req, status: r.status, ms: Date.now() - t, response: shape(j) };
  console.log(id, r.status, `${Date.now() - t} ms`);
}

await rec("recalls", "GET /api/v1/recalls?query=power%20bank&photo_refund=true&limit=2", "/api/v1/recalls?query=power%20bank&photo_refund=true&limit=2", undefined, (j) => trimHits(j, 2));
await rec("recall", "GET /api/v1/recalls/27056", "/api/v1/recalls/27056", undefined, (j) => ({
  ...j,
  data: { ...j.data, images: j.data.images.slice(0, 1), remedy_text: clip(j.data.remedy_text, 220), consumer_contact: clip(j.data.consumer_contact, 120), proof_rule: j.data.proof_rule && { ...j.data.proof_rule, explanation: { plain: j.data.proof_rule.explanation.plain, technical: clip(j.data.proof_rule.explanation.technical, 120) } } },
}));
await rec("proof-rule", 'POST /api/v1/proof-rule {"recall_number":"27056"}', "/api/v1/proof-rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recall_number: "27056" }) }, (j) => ({
  ...j,
  data: { ...j.data, method: clip(j.data.method, 90), rule: { ...j.data.rule, explanation: { plain: j.data.rule.explanation.plain, technical: clip(j.data.rule.explanation.technical, 120) } } },
}));
const form = new FormData();
form.append("photo", new Blob([readFileSync("content/verify/fixtures/official/27056-haiara-1.jpg")], { type: "image/jpeg" }), "photo.jpg");
form.append("recall_number", "27056");
await rec("verify", "POST /api/v1/verify (photo: the recall's own official picture, recall_number=27056, no key)", "/api/v1/verify", { method: "POST", body: form }, (j) => ({
  ...j,
  data: { ...j.data, summary: { plain: j.data.summary.plain, technical: clip(j.data.summary.technical, 160) }, checks: Object.fromEntries(Object.entries(j.data.checks).map(([k, c]) => [k, { ...c, technical: clip(c.technical, 100) }])) },
}));

writeFileSync("content/public/api-examples.json", JSON.stringify({ note: "Real responses from a local Remedy, recorded by scripts/public/api-examples.mjs. Long strings are shortened with ...", recordedAt: new Date().toISOString(), examples: out }, null, 1));
console.log("wrote content/public/api-examples.json");
