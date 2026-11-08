<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Remedy, for an agent reading this first

Remedy pays recall refunds through PayPal (sandbox) once one photo of the product made safe passes six checks; Claude reads remedies and photos, plain code decides and pays. The README's top screen says what it is and where to start; `docs/evidence-index.md` maps ten claims to a live page, a file and line, and a test. `npm test` runs with no keys and no database (the live and Postgres suites skip, counted in `content/public/facts.json`); `npm run typecheck`, `npm run lint` and `npm run build` are what CI runs. Figures the README, `docs/*.md` and the site repeat come from one file each (`scripts/facts.ts`, `src/lib/research.ts`, `content/recalls/*.json`), and `tests/facts.test.ts` fails when they disagree.
