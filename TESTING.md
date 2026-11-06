# Testing Remedy

Every check, how to run it, and its latest result. Everything runs against the PayPal sandbox; no real money moves.

## PayPal sandbox buyer login

Use this login in the PayPal window that opens from the sample shop's PayPal button.

| | |
|---|---|
| Email | `sb-tvnmx53636325@personal.example.com` |
| Password | `D.}t1I^T` |


- It is a PayPal sandbox personal account. It works only in the sandbox checkout window, and its balance is practice money.
- Please keep the password as it is, so the next person can use it too.

## Checks

| Check | Command | Latest result |
|---|---|---|
| Types | `npm run typecheck` | No errors |
| Lint | `npm run lint` | No problems |
| Unit tests, no network | `npm test` | All pass |
| Every page and public endpoint of a running server, each integration on its fallback when its key is missing | `npm run e2e:smoke` | All pass |
| axe (WCAG 2.2 AA) and sideways scroll on every page, desktop and phone, light and dark | `npm run e2e:a11y` | All 48 page views pass |
| The audit ledger's hash chain, straight from the database | `npm run verify-ledger` | Every hash links to the one before it |
| 60 ledger appends at once keep one chain | `npm run test:ledger-race` | Chain verified |

## The database

The schema is reviewed SQL in `db/schema.sql`, applied with `npm run db:migrate` (idempotent). `tests/schema.test.ts` checks that it and the Drizzle schema in `src/lib/db/schema.ts` define the same tables and columns. `npm run db:load` loads the recall data and `npm run db:seed` the sample firm; both can run again safely.
