# Algopay — Bulletproof Architecture (Validated March 2026)

> Agentic payment wallet for Algorand. The "Stripe for AI Agents" on Algorand.
> Inspired by [Coinbase AWAL](https://docs.cdp.coinbase.com/agentic-wallet/skills/overview).

## Core Principles

1. **Keys never touch the agent/LLM or CLI** — all signing via Intermezzo
2. **Test-first** — write connection tests → write code → integration tests
3. **Reference code first** — check external repos before implementing

---

## Dependency Availability Matrix (Validated)

| # | Component | Status | Evidence | Action |
|---|---|---|---|---|
| 1 | **Intermezzo** (Algorand Foundation, HashiCorp Vault KMS) | ✅ Live | REST API + OAuth2, GitHub `algorandfoundation/intermezzo`, used by WorldChess in production, launched Q3 2025 | Self-host via Docker Compose |
| 2 | **algorand-mcp** (GoPlausible, 125+ tools) | ✅ Live | npm `@goplausible/algorand-mcp`, GitHub `GoPlausible/algorand-mcp` | `npm install -g @goplausible/algorand-mcp` |
| 3 | **algorand-remote-mcp-lite** (Wallet Edition) | ✅ Live | OAuth 2.0/PKCE + OIDC social logins, on MCP Market | Plug in as MCP server |
| 4 | **GoPlausible x402 Bazaar** (facilitator + discovery) | ✅ Live | API at `api.goplausible.xyz`, `/discovery/resources` endpoint for service search, GoPlausible is official Algorand x402 facilitator | Direct REST calls |
| 5 | **GoPlausible OpenClaw Plugin** | ✅ Live | npm `@goplausible/openclaw-algorand-plugin`, LobeHub listing (March 2026) | Install for buyer-agent demos |
| 6 | **Vestige MCP** (DEX aggregator + price feeds) | ✅ Live | GitHub `vestige-fi/vestige-mcp`, $200M+ lifetime volume, WebSocket API | MCP server integration |
| 7 | **AlgoKit 4.0** (tx builder, atomic composer) | ✅ Live | Python + TypeScript SDKs, launched 2025 | `pip install algokit-utils` |
| 8 | **Algorand algod + Indexer** | ✅ Live | Core Algorand REST APIs, always available | Standard node connection |
| 9 | **AP2** (Google Cloud Agent Payments) | ✅ Live | Algorand is official Google Cloud AP2 partner | A2A protocol integration |
| 10 | **Pera Fund** (fiat + cross-chain onramp) | ✅ Live | Launched Jan 2026, Meld fiat + Exodus cross-chain swaps | Link to Pera mobile app |
| 11 | **Circle USDC APIs** | ✅ Live | Circle APIs for Algorand USDC since 2020 | REST API integration |
| 12 | **VibeKit** (project scaffolding) | ✅ Live | Launched Feb 5, 2026 by Algorand DevRel, `npx vibekit init` | Use for project init |
| 13 | **Auth Layer (Express/Hono)** | ✅ Done (Dev) | Implemented in `src/server/server.ts` with local OTP console logs. | **PROD LEFT:** SendGrid/Resend API, Redis for persistence. |
| 14 | **ARC-58 Smart Wallet** | ⚠️ Draft | ARC-58 spec is DRAFT, not production-deployed as standard. Akita Wallet has a reference implementation | **BUILD YOURSELF** or use simplified version (see Smart Wallet section below) |

---

## Current Progress Status

- **Phase 0: Project Scaffold** ✅ Complete (CLI, TS Config, All 7 connection tests passing)
- **Phase 1: Auth Layer** ✅ Implementation Complete (Dev Mode)
    - *Done:* POST `/auth/login`, `/auth/verify`, `/auth/logout`, `/auth/session`.
    - *Done:* 12 Auth Tests passing.
    - *Left for Prod:* Real Email delivery (SendGrid), Redis persistence, Intermezzo integration.

---

## Production Architecture

```
AI Agent / User
       ↓ (CLI commands or MCP skill calls)
Algopay CLI (`npx algopay`) — TypeScript
       ↓
MCP Runtime Layer
   ├── algorand-mcp SERVER (@goplausible/algorand-mcp, 125+ tools)
   └── algorand-remote-mcp-lite (Wallet Edition — OAuth/OIDC + signing)
       ↓
Backend (Express.js / Hono — TypeScript — Render / Railway / AWS)
   ├── Auth middleware (email OTP / OAuth)
   ├── Guardrails (spending limits, reputation, KYT)
   ├── Tx builder (AlgoKit TS — atomic groups)
   └── Signing Service → Intermezzo (self-hosted, Docker + Vault)
                  ↓ (REST calls, OAuth2 tokens)
On-Chain Layer
   ├── Standard Algorand Account (MVP) or ARC-58 Smart Wallet (V2)
   ├── Fee Pooling via Atomic Groups (backend wallet pays ALL fees)
   ├── x402 + AP2 dual-protocol support
   └── USDC (ASA) as primary stablecoin
                  ↓
Algorand Mainnet / Testnet
       ↑
Ecosystem Services (all ✅ live)
   ├── x402 Bazaar (GoPlausible — api.goplausible.xyz/discovery/resources)
   ├── AP2 Endpoints (Google Cloud partnership)
   ├── Vestige MCP (price feeds + smart swap routing)
   ├── Pera Fund (fiat onramp via Meld + cross-chain via Exodus)
   └── Circle USDC APIs (direct stablecoin integration)
```

---

## Workarounds for Unavailable Components

### 1. Auth Layer (Replacing GoPlausible dOAuth)

**Problem:** GoPlausible's dOAuth protocol exists but has no confirmed public email+OTP REST endpoint.

**Solution:** Self-hosted auth in the Express/Hono TypeScript backend. This is actually MORE production-grade because you control the entire flow.

```
User → `algopay auth login <email>`
  → Express Backend sends OTP via SendGrid/Resend/Mailgun
  → User → `algopay auth verify <flowId> <otp>`
  → Backend validates OTP
  → Backend exchanges for Intermezzo OAuth2 session token
  → Intermezzo creates/attaches wallet to session
  → Session token stored in ~/.algopay/config.json
```

**Implementation:**
- **OTP delivery:** SendGrid (free tier: 100 emails/day) or Resend
- **OTP storage:** Redis with 10-minute TTL (or in-memory Map for dev)
- **Session tokens:** JWT signed by backend, 30-day validity
- **Flow IDs:** UUID v4, single-use

### 2. Smart Wallet (ARC-58 is Draft)

**Problem:** ARC-58 is still a DRAFT spec. No production-deployed reference contract exists as a standard.

**Solution (Phased Approach):**

**MVP (Hackathon):** Use a standard Algorand account managed by Intermezzo. Spending limits and guardrails are enforced in the FastAPI backend middleware (not on-chain). Fee pooling still works via Atomic Groups because that's a native Algorand feature — no smart contract needed.

**V2 (Post-hackathon):** Build a PuyaPy smart wallet contract implementing ARC-58 draft features:
- On-chain spending limits
- Plugin registration (revenue split, escrow)
- On-chain guardrail enforcement

This phased approach means you have a **working product on day 1** without waiting for ARC-58 standardization.

---

## AWAL → Algopay Command Mapping

| AWAL Command | Algopay Command | How It Works |
|---|---|---|
| `npx awal status` | `npx algopay status` | MCP queries Intermezzo + Indexer |
| `npx awal auth login <email>` | `npx algopay auth login <email>` | FastAPI sends OTP via SendGrid → returns flowId |
| `npx awal auth verify <flowId> <otp>` | `npx algopay auth verify <flowId> <otp>` | Validates OTP → Intermezzo session → wallet attached |
| `npx awal balance` | `npx algopay balance` | Indexer query via MCP for ALGO + USDC + all ASAs |
| `npx awal address` | `npx algopay address` | Returns wallet address from local config |
| `npx awal show` | `npx algopay show` | Opens React dashboard (Vercel-hosted) |
| `npx awal send <amt> <to>` | `npx algopay send <amt> <to>` | Backend builds atomic group → Intermezzo signs → gasless |
| `npx awal trade <amt> <from> <to>` | `npx algopay trade <amt> <from> <to>` | Vestige MCP routing → DEX swap in atomic group → gasless |
| `npx awal x402 bazaar search <q>` | `npx algopay x402 bazaar search <q>` | GoPlausible `/discovery/resources` API (cached 1hr) |
| `npx awal x402 pay <url>` | `npx algopay x402 pay <url>` | Parse 402 header → Intermezzo signs → GoPlausible facilitator |
| Fund Wallet | `npx algopay fund` | Pera Fund (Meld fiat + Exodus cross-chain) or direct USDC deposit |
| Monetize Service | `npx algopay monetize <endpoint>` | **Algopay SDK:** x402 paywall middleware deployment (see below) |

All commands support `--json` and `--network testnet|mainnet`.

---

## Monetize SDK (Key Differentiator vs AWAL)

**The "1-line API monetization" feature.** This is the core value proposition for the hackathon.

### Python SDK (FastAPI)
```python
from algopay import paywall

@app.get("/api/air-quality")
@paywall(price=0.25, asset="USDC")
async def get_air_quality():
    return {"pm25": 12.3, "aqi": 48, "location": "Mumbai"}
```

### TypeScript SDK (Express)
```typescript
import { paymentMiddleware } from "@algopay/x402";

const payment = paymentMiddleware(PAY_TO_ADDRESS, {
  "GET /api/data": { price: "$0.05", network: "algorand-mainnet" },
  "POST /api/query": { price: "$0.25", network: "algorand-mainnet" }
});

app.get("/api/data", payment, (req, res) => { /* ... */ });
```

### How it works under the hood:
1. Middleware intercepts incoming request
2. Checks for `Authorization: x402 <tx-hash>` header
3. If missing → returns HTTP 402 with `X-Payment: { price, asset, payTo, network, facilitator }`
4. If present → validates tx on-chain via Indexer → allows request through
5. GoPlausible Bazaar auto-indexes the endpoint for AI agent discovery

### vs AWAL's `paymentMiddleware`:
- AWAL requires `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (centralized Coinbase dependency)
- **Algopay uses on-chain verification via Algorand Indexer** (no proprietary API keys needed)
- AWAL is locked to Base (Ethereum L2). Algopay is native Algorand (faster, cheaper)

---

## Security Boundaries (Critical for Agents)

**NEVER** do these inside any agent/LLM context:
- Generate or store private keys
- Call raw `algosdk` signing functions
- Bypass Intermezzo
- Store OTP secrets in agent memory

**Always** route through:
```python
# Correct pattern — Backend calls Intermezzo
response = await intermezzo_client.sign_transaction(unsigned_tx, session_context)
# Intermezzo is the ONLY place keys exist
```

**Security layers (defense in depth):**
1. **Agent layer:** No keys, no signing capability
2. **CLI layer:** Session token only, stored `~/.algopay/config.json` (perms 600)
3. **Backend layer:** Guardrails (spending limits + KYT) applied BEFORE calling Intermezzo
4. **Intermezzo layer:** Keys in Vault, OAuth2 session required, audit log
5. **On-chain layer:** Atomic groups ensure all-or-nothing execution

---

## Production Runtime Stack

| Component | Tool | Hosting |
|---|---|---|
| Build time | VibeKit (`npx vibekit init`) | Local |
| CLI | TypeScript, published to npm | User's machine |
| MCP Runtime | algorand-mcp + algorand-remote-mcp-lite | Co-located with CLI |
| Backend | Express.js / Hono (TypeScript) | Render / Railway / AWS |
| Signing | Intermezzo (Docker + Vault) | Self-hosted VPS or AWS |
| Dashboard | React | Vercel |
| Session store | Redis | Render Redis / AWS ElastiCache |
| OTP delivery | SendGrid / Resend | SaaS |

---

## External References (Always Check These First)

1. **Intermezzo:** https://github.com/algorandfoundation/intermezzo
2. **GoPlausible x402 + MCP:** https://github.com/goplausible
3. **GoPlausible API:** https://api.goplausible.xyz/docs
4. **algorand-remote-mcp-lite:** https://github.com/algorand-devrel/algorand-remote-mcp-lite
5. **Vestige MCP:** https://github.com/vestige-fi/vestige-mcp
6. **OpenClaw Algorand Plugin:** npm `@goplausible/openclaw-algorand-plugin`
7. **AlgoKit:** https://developer.algorand.org/docs/get-started/algokit/
8. **x402 Protocol:** https://x402.org
9. **AWAL (Inspiration):** https://docs.cdp.coinbase.com/agentic-wallet/skills/overview
10. **Pera Fund:** https://perawallet.app
11. **Circle USDC on Algorand:** https://developers.circle.com
