import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rows a test script makes or fakes carry claim.origin = 'test' and stay out of every firm console list and count.
 * The scripts that make them mark them; each console query carries the filter from src/lib/firm/origin.ts. The
 * Postgres half (tests/firm-origin.pg.test.ts) checks the home tiles and the queue on a real database.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

describe("test rows in the firm console", () => {
  it("claim.origin exists in the reviewed SQL and the Drizzle schema, app by default, test only for scripts", () => {
    const sql = read("db", "schema.sql");
    expect(sql).toMatch(/origin\s+text not null default 'app' check \(origin in \('app', 'test'\)\)/);
    expect(sql).toContain("alter table claim add column if not exists origin text not null default 'app';");
    // Earlier seeded UNCLAIMED payouts become test rows when the schema is applied.
    expect(sql).toMatch(/update claim set origin = 'test' where origin = 'app' and id in \(select claim_id from payment where error ->> 'issue' = 'SEEDED_FOR_DEMO'\);/);
    expect(sql.indexOf("SEEDED_FOR_DEMO")).toBeGreaterThan(sql.indexOf("create table if not exists payment ("));
    expect(read("src", "lib", "db", "schema.ts")).toContain('origin: text("origin").notNull().default("app")');
  });

  it("the scripts that make or fake a row mark it, and the probe writes none", () => {
    const e2e = read("scripts", "payments", "e2e.ts");
    expect(e2e).toMatch(/insert into claim \([^)]*\borigin\)/);
    expect(e2e.match(/\$\{TEST_ORIGIN\}\)/g)?.length).toBe(2);
    const seed = read("scripts", "payments", "seed-event.ts");
    expect(seed).toContain("update claim set origin = ${TEST_ORIGIN} where id = ${claim}::uuid");
    expect(seed.indexOf("recordStatus(payment")).toBeLessThan(seed.indexOf("update claim set origin"));
    const probe = read("scripts", "payments", "sandbox-probe.ts");
    expect(probe).toContain("new MemoryStore()");
    expect(probe).not.toMatch(/from "\.\.\/\.\.\/src\/lib\/db"/);
  });

  it("every firm console query over claims leaves test rows out", () => {
    const filtered: Record<string, number> = {
      // the home tiles: claims and units, refunds paid, needs a person, waiting to be accepted (list and count), claims per recall
      "src/lib/firm/home.ts": 5,
      // the claims queue and its drawer rows
      "src/lib/firm/queue.ts": 1,
      // the monthly report's claims and payments
      "src/lib/firm/report-data.ts": 2,
      // the live payment feed
      "src/lib/firm/live.ts": 1,
      // the review schedule, and the plan's tasks on load
      "src/lib/firm/plan-data.ts": 2,
      // claims per sale on the buyers page
      "src/lib/firm/buyers-data.ts": 1,
    };
    for (const [file, n] of Object.entries(filtered)) {
      const text = read(...file.split("/"));
      const uses = (text.match(/\$\{notTest(?:Task)?\((?:"[a-z]+")?\)\}/g) ?? []).length;
      expect(uses, file).toBe(n);
      expect(text, file).toMatch(/import \{[^}]*notTest[^}]*\} from "\.\/origin";/);
    }
    // The e2e report check counts in SQL the same way.
    expect(read("tests", "e2e", "firm.mjs").match(/origin <> 'test'/g)?.length).toBe(5);
  });
});
