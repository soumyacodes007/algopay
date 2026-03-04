# Algopay — Production Build Plan (4 Weeks)

**Timeline:** March 4 – April 4, 2026 · **Goal:** Production-ready deployment

Each phase maps to specific requirement numbers from [requirements.md](file:///C:/Users/soumy/OneDrive/Desktop/algopay/requirements.md). Build order follows the dependency chain — each phase depends on the one before it.

---

## Phase 0: Project Scaffold & Connection Tests
**Time: ~2 hours** · **Reqs: 1, 47, 55**

### What to build
- Run `npx vibekit init` to scaffold CLI + MCP config (Req 47)
- Configure `package.json` with `bin: { "algopay": "./dist/cli.js" }` (Req 1)
- Add `--network` and `--json` flag parsers (Req 1)
- Write **connection tests** for ALL external services before any other code (Req 55)

### Connection tests to write (Req 55)
| Test | Endpoint | Pass criteria |
|---|---|---|
| Intermezzo health | `GET /v1/health` | 200 OK |
| Algod status | `GET /v2/status` | returns `last-round` |
| Indexer health | `GET /health` | 200 OK |
| algorand-mcp handshake | MCP protocol `initialize` | returns capabilities |
| GoPlausible Bazaar | `GET api.goplausible.xyz/docs` | 200 OK |
| Vestige MCP | MCP protocol `initialize` | returns tool list |
| HashiCorp Vault | `GET /v1/sys/seal-status` | returns `sealed: false` |

### Test command
```bash
npx algopay test:connections --network testnet
```

### Done when
- [ ] `npx algopay --version` prints version
- [ ] `npx algopay --help` shows all commands
- [ ] All 7 connection tests pass on testnet

---

## Phase 1: Auth Layer (Self-Hosted OTP)
**Time: ~4 hours** · **Reqs: 2, 3, 21, 44**

### What to build
- FastAPI `POST /auth/login` — accepts email, sends OTP via SendGrid, returns `flowId` (Req 2)
- FastAPI `POST /auth/verify` — validates OTP, creates Intermezzo session, returns session token + wallet address (Req 3)
- OTP stored in Redis with 10-min TTL, max 3 attempts per flowId (Req 2, 3)
- Session token: JWT (HS256), 30-day validity, stored at `~/.algopay/config.json` with perms 600 (Req 21)
- FastAPI `POST /auth/logout` — invalidates session (Req 21)
- Input sanitization on email field (Req 44)
- Rate limiting: 5 login attempts per email per hour (Req 44)

### CLI commands
```
algopay auth login <email>
algopay auth verify <flowId> <otp>
algopay auth logout
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Invalid email rejected locally | Unit | Req 2.4 — no network call made |
| Valid email triggers OTP | Integration | Req 2.1–2.3 — SendGrid called, flowId returned |
| Correct OTP returns token | Integration | Req 3.1–3.4 — Intermezzo session created |
| Expired OTP rejected | Unit | Req 3.6 — 10 min TTL enforced |
| 3 failed attempts invalidates flowId | Unit | Req 3.7 |
| Session persists across CLI calls | Integration | Req 21.1–21.3 |
| Logout clears token | Unit | Req 21.6 |

### Done when
- [ ] `algopay auth login test@test.com` sends OTP, returns flowId
- [ ] `algopay auth verify <flowId> <otp>` returns wallet address
- [ ] Session token persists in `~/.algopay/config.json`

---

## Phase 2: Core Wallet Operations
**Time: ~4 hours** · **Reqs: 4, 5, 6, 16, 17, 20, 26, 27, 32, 33**

### What to build
- `algopay status` — queries Intermezzo + Indexer via MCP (Req 4)
- `algopay balance` — ALGO + all ASA balances from Indexer (Req 5)
- `algopay address` — from local config (Req 6)
- `algopay history` — reverse-chronological tx list from Indexer (Req 20)
- Atomic group builder using AlgoKit (Req 16, 32)
- Fee pooling: user tx fee = 0, backend wallet pays (Req 33)
- Intermezzo signing integration: unsigned tx → REST API → signed tx (Req 17)
- Transaction confirmation: poll every 1s for 10s (Req 27)
- Network selection: `--network testnet|mainnet` (Req 26)

### CLI commands
```
algopay status
algopay balance [--json]
algopay address [--json]
algopay history [--limit <n>] [--type <send|receive|trade>] [--json]
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Status returns wallet info | Integration | Req 4.2–4.3 |
| Balance shows USDC + ALGO | Integration | Req 5.1–5.4 |
| Address matches Intermezzo | Unit | Req 6.1–6.2 |
| Atomic group has correct fee structure | Unit | Req 33.2–33.4 |
| Intermezzo signs valid tx | Integration | Req 17.1–17.6 |
| Tx confirms within 10s | Integration | Req 27.1–27.5 |
| History returns ordered txs | Integration | Req 20.1–20.5 |

### Done when
- [ ] `algopay balance --json` returns correct ALGO/USDC balances on testnet
- [ ] Fee pooling produces user tx with fee = 0

---

## Phase 3: Send & Guardrails
**Time: ~4 hours** · **Reqs: 8, 14, 15, 28, 36, 37, 52**

### What to build
- `algopay send <amount> <recipient>` — validates → guardrails → atomic group → Intermezzo sign → broadcast (Req 8)
- Spending limits: `algopay config set-limit <amount> <period>` (Req 14)
- KYT blocklist check on recipient (Req 15)
- Guardrails pipeline: limits → KYT → per-tx max → then Intermezzo (Req 28)
- Multi-asset support: resolve asset name → ID, auto opt-in (Req 36)
- Dry-run mode: `--dry-run` simulates via Algorand simulate endpoint (Req 37)
- Idempotency: reject duplicate tx IDs (Req 52)

### CLI commands
```
algopay send <amount> <recipient> [--asset <id>] [--dry-run] [--json]
algopay config set-limit <amount> <period>
algopay config get-limit
algopay asset opt-in <asset-id>
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Send 1 USDC between test wallets | Integration (testnet) | Req 8.1–8.8 |
| Spending limit blocks over-limit tx | Unit | Req 14.4, 28.2 |
| Blocklisted address rejected | Unit | Req 15.2–15.3 |
| Dry-run shows expected outcome | Integration | Req 37.2–37.5 |
| Duplicate tx ID rejected | Unit | Req 52.2 |
| Auto opt-in on first asset send | Integration | Req 36.4 |

### Done when
- [ ] `algopay send 1 USDC <testnet-addr>` confirms on testnet with zero user fee
- [ ] Over-limit transactions are rejected before hitting Intermezzo

---

## Phase 4: Trading via Vestige
**Time: ~3 hours** · **Reqs: 9, 24**

### What to build
- `algopay trade <amount> <from> <to>` — Vestige MCP routing → best DEX path → atomic group → sign → broadcast (Req 9)
- Vestige MCP integration: query routes from Tinyman + Humble (Req 24)
- Slippage protection: 2% default, configurable (Req 24.6)
- Price impact warning > 5% (Req 24.5)

### CLI commands
```
algopay trade <amount> <from> <to> [--slippage <pct>] [--dry-run] [--json]
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Vestige returns valid routes | Integration | Req 24.1–24.3 |
| Trade executes on testnet | Integration | Req 9.6–9.9 |
| Slippage > 2% rejected | Unit | Req 9.10 |
| Price impact > 5% warns | Unit | Req 24.5 |

### Done when
- [ ] `algopay trade 1 ALGO USDC --network testnet` executes a swap

---

## Phase 5: x402 Discovery & Payment
**Time: ~4 hours** · **Reqs: 10, 11, 49**

### What to build
- `algopay x402 bazaar search <query>` — calls GoPlausible `/discovery/resources`, caches 1hr (Req 10, 49)
- `algopay x402 pay <url>` — parse 402 header → build atomic group with facilitator → sign → send → retry with auth header (Req 11)
- GoPlausible facilitator fee included in tx (Req 49.7)
- Fuzzy search + category filter (Req 49.2, 49.4)

### CLI commands
```
algopay x402 bazaar search <query> [--category <cat>] [--json]
algopay x402 pay <url> [--json]
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Bazaar search returns results | Integration | Req 10.1–10.3 |
| Search results cached 1hr | Unit | Req 10.2 |
| x402 pay flow end-to-end | Integration | Req 11.1–11.9 |
| Malformed URL rejected locally | Unit | Req 11.10 |

### Done when
- [ ] `algopay x402 bazaar search "weather"` returns service listings
- [ ] `algopay x402 pay <test-url>` completes a payment and receives data

---

## Phase 6: Monetize SDK (Key Differentiator)
**Time: ~4 hours** · **Reqs: 13**

### What to build
- `algopay monetize <endpoint>` — generates x402 paywall config + registers with GoPlausible Bazaar (Req 13)
- **Python SDK:** `@paywall(price=0.25, asset="USDC")` decorator for FastAPI
- **TypeScript SDK:** `paymentMiddleware(payTo, routes)` for Express
- On-chain verification: middleware checks tx hash on Algorand Indexer (no proprietary API keys)
- Auto-register endpoint on GoPlausible Bazaar for AI agent discovery
- npm package: `@algopay/x402`
- PyPI package: `algopay`

### SDK code structure
```
packages/
  algopay-sdk-python/     # PyPI: algopay
    algopay/paywall.py    # @paywall decorator
  algopay-sdk-typescript/ # npm: @algopay/x402
    src/middleware.ts      # paymentMiddleware()
```

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Python decorator returns 402 on unpaid request | Unit | Middleware intercepts |
| Python decorator passes on valid tx hash | Integration (testnet) | On-chain verification works |
| TS middleware returns 402 on unpaid request | Unit | Middleware intercepts |
| TS middleware passes on valid tx hash | Integration (testnet) | On-chain verification works |
| `algopay monetize` registers endpoint | Integration | Req 13.2–13.4 |

### Done when
- [ ] A FastAPI endpoint decorated with `@paywall` returns HTTP 402 to unauthorized requests
- [ ] An OpenClaw agent can autonomously discover and pay the paywalled endpoint

---

## Phase 7: Wallet Funding
**Time: ~2 hours** · **Reqs: 12**

### What to build
- `algopay fund` — displays address + opens Pera Fund / Circle onramp (Req 12)
- `--watch` flag polls Indexer for incoming deposits (Req 12.6)

### CLI commands
```
algopay fund [--watch] [--json]
```

### Done when
- [ ] `algopay fund` shows address and Pera Fund link
- [ ] `algopay fund --watch` detects incoming testnet deposit

---

## Phase 8: Dashboard
**Time: ~4 hours** · **Reqs: 7, 29**

### What to build
- React app on Vercel (Req 7)
- WebSocket live updates from backend (Req 29)
- Views: balance, tx history, spending limits, incoming payment stream
- `algopay show` opens dashboard in browser (Req 7.1)

### Tests to write
| Test | Type | What it verifies |
|---|---|---|
| Dashboard loads with valid session | Browser | Req 7.2–7.4 |
| WebSocket updates on new tx | Browser | Req 29.1–29.5 |
| Invalid session redirects to auth | Browser | Req 7.5 |

### Done when
- [ ] Dashboard shows live balance and tx stream

---

## Phase 9: Advanced Features
**Time: ~4 hours** · **Reqs: 25, 34, 35, 38, 39, 48**

### What to build
- Config management: `algopay config set|get|list` (Req 25)
- Batch transactions: `algopay batch <file>` — max 16 per group (Req 38)
- Webhook notifications: `algopay webhook add|list|remove` (Req 39)
- AP2 protocol support: `algopay ap2 pay <url>` (Req 35)
- MCP skill interface: expose all commands as MCP tools (Req 48)
- ARC-58 plugin system (V2, post-hackathon): revenue split, escrow, dynamic limits (Req 34)

### Done when
- [ ] Batch of 3 txs executes atomically on testnet
- [ ] Webhook fires on send event

---

## Phase 10: Production Hardening
**Time: ~6 hours** · **Reqs: 22, 23, 30, 31, 40, 41, 43, 44, 45, 46**

### What to build
- Error handling with codes + guidance (Req 22)
- Backend REST API: rate limiting, CORS, validation (Req 23)
- Intermezzo health monitoring + circuit breaker (Req 30)
- Audit logging with crypto signatures (Req 31)
- Performance: connection pooling, caching, horizontal scaling (Req 40)
- Deployment: Docker, Docker Compose, env vars, `/health`, `/metrics` (Req 41)
- Documentation: README, API docs, CLI docs, plugin guide (Req 43)
- Security hardening: TLS 1.3, CSRF, HSTS, CSP (Req 44)
- Observability: Prometheus metrics, OpenTelemetry, Grafana templates (Req 45)
- DR: backup/restore procedures, runbooks (Req 46)

### Done when
- [ ] `docker compose up` starts full stack locally
- [ ] `/health` and `/metrics` endpoints respond

---

## Phase 11: Testing Suite
**Time: ~4 hours** · **Reqs: 42, 50, 51, 52, 53, 54, 56, 57, 58, 59, 60**

### What to build
- Correctness properties (Req 50): invariant assertions in every tx flow
- Round-trip serialization tests (Req 51)
- Idempotency tests (Req 52)
- Metamorphic tests for tx validation (Req 53)
- Error condition tests (Req 54)
- Full integration test suite on testnet (Req 56)
- Property-based tests with Hypothesis/fast-check (Req 57)
- Security tests: no key leaks, bypass prevention (Req 58)
- Performance/load tests: 100 concurrent users (Req 59)
- Deployment smoke tests (Req 60)

### Done when
- [ ] `npm test` passes with 80%+ coverage
- [ ] Testnet integration suite passes end-to-end

---

## 4-Week Production Calendar

### Week 1 (Mar 4–10): Foundation + Auth + Core Wallet

| Day | Phase | Deliverable | Reqs |
|---|---|---|---|
| Mon | Phase 0 | VibeKit scaffold, CLI shell, all 7 connection tests green | R1, R47, R55 |
| Tue | Phase 1 | FastAPI auth: `/auth/login`, `/auth/verify`, SendGrid OTP, Redis TTL | R2, R3 |
| Wed | Phase 1 | Session management, JWT tokens, `~/.algopay/config.json`, logout | R21, R44 |
| Thu | Phase 2 | `status`, `balance`, `address` commands via MCP + Indexer | R4, R5, R6 |
| Fri | Phase 2 | AlgoKit atomic group builder, fee pooling (user fee = 0) | R16, R32, R33 |
| Sat | Phase 2 | Intermezzo signing integration, tx confirmation polling | R17, R27 |
| Sun | Phase 2 | `history` command, network selection, integration tests | R20, R26 |

**Week 1 milestone:** `algopay auth login` → `algopay balance` works end-to-end on testnet with gasless fee pooling.

---

### Week 2 (Mar 11–17): Send + Guardrails + Trading + x402

| Day | Phase | Deliverable | Reqs |
|---|---|---|---|
| Mon | Phase 3 | `send` command: validate → build atomic group → sign → broadcast | R8 |
| Tue | Phase 3 | Spending limits engine, KYT blocklist, guardrails pipeline | R14, R15, R28 |
| Wed | Phase 3 | Multi-asset support, auto opt-in, dry-run simulation, idempotency | R36, R37, R52 |
| Thu | Phase 4 | Vestige MCP integration, DEX route selection, slippage protection | R9, R24 |
| Fri | Phase 5 | `x402 bazaar search` — GoPlausible `/discovery/resources`, local cache | R10, R49 |
| Sat | Phase 5 | `x402 pay` — parse 402 header, atomic group with facilitator, retry flow | R11 |
| Sun | — | Integration tests for all Week 2 features on testnet | R56 |

**Week 2 milestone:** Full send/trade/x402-pay pipeline works. Guardrails block over-limit and blocklisted txs.

---

### Week 3 (Mar 18–24): Monetize SDK + Dashboard + Advanced

| Day | Phase | Deliverable | Reqs |
|---|---|---|---|
| Mon | Phase 6 | Python SDK: `@paywall` decorator, on-chain verification via Indexer | R13 |
| Tue | Phase 6 | TypeScript SDK: `paymentMiddleware()`, npm `@algopay/x402` | R13 |
| Wed | Phase 6 | `algopay monetize` CLI command, auto-register on GoPlausible Bazaar | R13 |
| Thu | Phase 7 | `algopay fund` — Pera Fund link, Circle onramp, `--watch` polling | R12 |
| Fri | Phase 8 | React dashboard: balance view, tx history, spending limits display | R7 |
| Sat | Phase 8 | WebSocket live updates, notification banners, reconnect logic | R29 |
| Sun | Phase 9 | Config management, batch transactions, webhook notifications | R25, R38, R39 |

**Week 3 milestone:** Monetize SDK works (Python + TS). Dashboard shows live payments. OpenClaw agent can discover and pay a paywalled endpoint autonomously.

---

### Week 4 (Mar 25–31): Hardening + Testing + Docs + Deploy

| Day | Phase | Deliverable | Reqs |
|---|---|---|---|
| Mon | Phase 9 | AP2 protocol support, MCP skill interface for AI agents | R35, R48 |
| Tue | Phase 10 | Error handling with codes, backend rate limiting, CORS, input validation | R22, R23 |
| Wed | Phase 10 | Intermezzo health monitoring, circuit breaker, audit logging | R30, R31 |
| Thu | Phase 10 | Docker + Docker Compose for full stack, `/health`, `/metrics`, env vars | R41, R45 |
| Fri | Phase 10 | Security hardening: TLS 1.3, CSRF, HSTS, CSP, key leak prevention | R44 |
| Sat | Phase 11 | Full test suite: unit, integration, property-based, security, performance | R42, R50–60 |
| Sun | Phase 10 | Documentation: README, API docs, CLI docs, deployment guide, DR runbooks | R43, R46 |

**Week 4 milestone:** `docker compose up` launches full production stack. All tests pass. Docs complete.

---

### Buffer Days (Apr 1–4): Polish + Demo

| Day | Focus |
|---|---|
| Apr 1 | End-to-end smoke test on mainnet (small real USDC amounts) |
| Apr 2 | Performance tuning: connection pooling, caching, load test 100 users (R40, R59) |
| Apr 3 | Record demo video: full agent-pays-sensor flow |
| Apr 4 | **Ship day** — deploy to production, publish npm packages |

---

## Daily Workflow

Every day follows this cycle:
1. **Write connection/unit tests first** for the day's feature
2. **Implement** the feature
3. **Run integration tests** on testnet
4. **Commit + push** with conventional commit messages
5. **Update task.md** with progress
