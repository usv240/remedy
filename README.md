# Remedy

**Recall refunds in seconds: snap a photo of the product made safe, AI verifies it against the official recall, and PayPal pays you, so recalled products leave homes faster.**

Many US product recalls already offer a refund once the owner sends a photo showing the product made safe: the cord cut, the item cut in half, or "RECALLED" written on it in marker. Today those photos go to an inbox and are checked by hand. Remedy reads each official CPSC remedy as a clear checklist, checks the owner's photo against it, and pays the refund through PayPal. Firms get a claims queue, a corrective-action plan that updates itself from payout webhooks, and their monthly progress report.

Built for the PayPal AI Hackathon, November 2026. Demonstration in PayPal sandbox. Recall data and images: U.S. Consumer Product Safety Commission. Brightline Home, the firm in the console, is a fictional sample firm.

## How it works

1. **Recall.** The official remedy text becomes a structured proof rule: what to cut or mark, what the photo must show, and the refund.
2. **Photo.** The owner snaps a photo on a phone. No account needed.
3. **Checks.** Right product, made safe, their own photo, within the recall, within the claim limits, not already refunded.
4. **Decision.** Verified, retake (with guidance), or a review by a person at the firm. Unclear photos get two AI reviewers first.
5. **Payment.** PayPal Payouts to an email, a phone number or Venmo; a refund to the original PayPal purchase inside 180 days; or a safe replacement.
6. **Firm loop.** The claims queue, the corrective-action plan and the CPSC monthly progress report.

The money math, the decision and the payment route are plain code. Claude reads the remedies and the photos.

## Built with

| Tool | Its one job here |
|---|---|
| PayPal | Pays refunds instantly; refunds to the original purchase inside 180 days |
| Claude Opus 5.5 | Reads each remedy into a checklist; verifies photos; runs the two reviewers |
| Elastic | Searches every recall; matches photos to official recall images |
| Channel3 | Finds a safe replacement product |
| Bryntum | The corrective-action plan and the review schedule |
| AG Grid and AG Studio | The claims queue and the completion dashboard |
| KERNEL | Reads recall pages and firm recall sites |
| Render | Hosting, Postgres and payout workflows |
| APIMatic | The PayPal SDK we build with; SDKs and docs for our API |

Every service except Postgres is optional when you run it yourself: without its key, each one uses a fallback, and `/status` shows which mode each is in.

## Run it yourself

You need Node 24 and Docker.

```bash
git clone https://github.com/usv240/remedy
cd remedy
npm ci                      # also copies Bryntum Gantt's script into public/bryntum/
cp .env.example .env.local  # fill in what you have; DATABASE_URL is the only one required
docker compose up -d        # Postgres 17 on port 5432
npm run db:migrate          # applies the reviewed schema in db/schema.sql
npm run db:load             # loads content/recalls/ (recalls, proof rules, image hashes)
npm run db:seed             # the sample firm, Brightline Home
npm run dev                 # http://localhost:3300
```

For a production build: `npm run build`, then `PORT=3400 npm start`.

### Checks

```bash
npm run typecheck
npm run lint
npm test                    # unit tests, no network
npm run e2e:smoke           # every page and public endpoint of a running server (BASE_URL, default :3300)
npm run e2e:a11y            # axe (WCAG 2.2 AA) and sideways scroll, desktop and phone, light and dark
```

`TESTING.md` lists every test, how to run it and its latest result.

## Project layout

| Path | What lives there |
|---|---|
| `src/app` | Pages and API routes (Next.js 16 App Router) |
| `src/lib/recall` | Recall data, proof rules and search |
| `src/lib/verify` | The photo checks and the decision |
| `src/lib/payments` | Payouts, refunds, the sample shop and the payment router |
| `src/lib/db` | The Drizzle schema; `db/schema.sql` is the reviewed SQL that is applied |
| `src/lib/audit.ts` | The hash-chained audit ledger |
| `src/lib/api`, `src/app/api/mcp` | The public API (keys, envelope, OpenAPI 3.1) and the MCP server |
| `content/info.json` | The words behind every Info button |

## Developers

- REST API described in OpenAPI 3.1 at `/openapi.json`, with docs at `/developers/docs` and a playground at `/developers`.
- MCP server over streamable HTTP: `claude mcp add --transport http remedy <host>/api/mcp`.
- Discovery: `/llms.txt`, `/.well-known/ai-catalog.json`, `/api/mcp/server-card`.

## License

MIT. Fonts: Sentient by Indian Type Foundry (ITF Free Font License) and IBM Plex Sans by IBM (SIL Open Font License), both self-hosted with their licences in `src/app/fonts/`.
