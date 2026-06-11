# PIXA Hub

PIXA Hub is the treasury-backed payment service behind the PIXA desktop wallet flow. It accepts authenticated payment requests from the desktop client, reserves user balance in Postgres, creates x402 payment signatures from the Base treasury wallet, and records the resulting ledger state.

## What is in this package

- `src/api/` HTTP handlers for health, admin, and payment routes
- `src/core/` auth, environment loading, and shared error helpers
- `src/db/` Drizzle schema, client setup, and migration entrypoint
- `src/x402/` seller payment-requirement parsing and x402 signature creation
- `test/` package-local tests for authenticated pay-request verification and x402 parsing edge cases

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in `DATABASE_URL`, `PIXA_ADMIN_SECRET`, and `BASE_TREASURY_PRIVATE_KEY`.
3. Install dependencies with `npm install`.
4. Run migrations with `npm run db:migrate`.
5. Start the service with `npm run dev`.

The default local port is `3001`.

## Scripts

- `npm run dev` start the Hono server with live reload
- `npm run build` compile TypeScript into `dist/`
- `npm run start` run the compiled server
- `npm test` run the package-local Node test suite
- `npm run test:coverage` run the same tests with Node coverage output
- `npm run typecheck` verify TypeScript types without emitting build output
- `npm run db:generate` generate Drizzle SQL artifacts
- `npm run db:migrate` run DB migrations
- `npm run db:studio` open Drizzle Studio

## Test coverage in this package

The added tests intentionally target the highest-signal pure logic without changing runtime code:

- authenticated desktop pay-request verification
  - valid Algorand signature flow
  - mismatched signed/body address rejection
  - expired timestamp rejection
  - body hash mismatch rejection
  - invalid signature rejection
- seller x402 payment-requirement parsing
  - supported network normalization
  - exact-scheme filtering
  - amount vs `maxAmountRequired` handling
  - malformed payload rejection
  - missing-network and missing-amount edge cases

## Manual checks still worth doing

This package still depends on external systems for full end-to-end confidence:

- Postgres balance reservation and ledger persistence
- Base treasury wallet funding and x402 payload creation
- desktop-to-hub authenticated `/api/pay` requests
- admin routes using `PIXA_ADMIN_SECRET`

For demo or panel prep, the fast verification path is:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. smoke test `/health`
5. smoke test one signed `/api/pay` request against a non-production wallet

## Repo hygiene notes

Generated artifacts are intentionally ignored in `.gitignore`:

- `dist/`
- `node_modules/`
- `*.log`
- `.env`
- coverage output

That keeps the package reviewable and reduces noise for technical judging.
