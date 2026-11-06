import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

/** Tables and their columns as db/schema.sql creates them. */
function sqlTables(): Map<string, string[]> {
  const text = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8").replace(/--.*$/gm, "");
  const out = new Map<string, string[]>();
  for (const m of text.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z_][a-z0-9_]*\s/.test(l) &&!/^(check|primary|unique|constraint|foreign)\b/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    out.set(m[1], cols);
  }
  return out;
}

const drizzleTables = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v);

describe("db/schema.sql and the Drizzle schema", () => {
  const fromSql = sqlTables();

  it("define the same tables, the ones plan section 8 names", () => {
    const names = drizzleTables.map((t) => getTableConfig(t).name).sort();
    expect([...fromSql.keys()].sort()).toEqual(names);
    expect(names).toEqual(
      [
        "ai_usage",
        "api_key",
        "api_usage",
        "audit_event",
        "claim",
        "firm",
        "firm_recall",
        "image_hash",
        "integration_status",
        "job",
        "notice",
        "outbound_webhook",
        "payment",
        "payment_plan",
        "photo",
        "plan_task",
        "proof_rule",
        "rate_limit",
        "recall",
        "report",
        "request_log",
        "sale",
        "verify_result",
        "webhook_event",
      ].sort(),
    );
  });

  it("give every table the same columns", () => {
    for (const t of drizzleTables) {
      const cfg = getTableConfig(t);
      expect(fromSql.get(cfg.name), cfg.name).toEqual(cfg.columns.map((c) => c.name));
    }
  });

  it("keep one payment plan per claim, so a second pay never pays twice", () => {
    const text = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");
    expect(text).toMatch(/create unique index if not exists payment_plan_claim_idx on payment_plan \(claim_id\)/);
    const cfg = getTableConfig(schema.paymentPlans);
    expect(cfg.indexes.some((i) => i.config.unique && i.config.columns.map((c) => ("name" in c ? c.name : "")).join() === "claim_id")).toBe(true);
  });

  it("store no contact detail in the clear", () => {
    const personal = /email|phone|contact|payee_value/;
    for (const t of drizzleTables) {
      const cfg = getTableConfig(t);
      // A firm's own published contact address and a developer's key email are not owners' personal data.
      if (cfg.name === "firm" || cfg.name === "api_key" || cfg.name === "recall") continue;
      for (const c of cfg.columns) if (personal.test(c.name)) expect(c.name, `${cfg.name}.${c.name}`).toMatch(/_(enc|hash)$/);
    }
  });
});
