# Pixa Treasury Wallet Plan

**Updated on April 20, 2026. This plan replaces the bridge-first Phase 2 thesis with a treasury/float architecture built for x402 micropayments.**

## 1. Decision

### Recommended Approach

Use a **treasury/float architecture**, not a bridge-in-the-request-path architecture.

This means:

- The user funds **Algorand USDC** only.
- The desktop wallet stays **Algorand-first**.
- For **Algorand seller APIs**, the desktop pays directly.
- For **non-Algorand seller APIs** like Base, the **Pixa Hub** pays from a **native prefunded treasury wallet** on that chain.
- User balances are tracked in a **backend ledger first**, not an Algorand smart contract.
- Bridging is **not part of the live payment flow**.

### Why This Is Better

- x402 sellers still require payment on the **seller's requested chain**.
- Micropayments do not tolerate bridge latency.
- Micropayments also do not tolerate bridge fees well.
- The user experience becomes instant and predictable.
- The business becomes treasury management, not per-request bridging.

### Final Product Thesis

Pixa is an **Algorand-funded agent wallet** with a **backend balance ledger** and **native treasury floats on destination chains**.

---

## 2. Business Model

### What Pixa Sells

Pixa sells **instant agent payments across seller chains** while keeping the user's funding experience simple.

The user only needs:

- one Algorand wallet
- one Algorand USDC balance

Pixa handles:

- chain-specific treasury liquidity
- payment execution on seller chains
- internal accounting between Algorand user balances and treasury usage
- backend-ledger debits and credits for instant micropayment routing

### Revenue Model

- charge a **payment facilitation spread or fee** per non-Algorand payment
- optionally offer:
  - free/cheap direct Algorand payments
  - premium instant non-Algorand payments
  - enterprise treasury accounts later

### Unit Economics

This model is better for micropayments than bridging every request because:

- you avoid bridge fees in the hot path
- you avoid bridge delay in the hot path
- you can batch treasury replenishment later

---

## 3. Product Flow

### A. Algorand API Flow

1. User has Algorand USDC in the local wallet.
2. API returns `402 Payment Required`.
3. `x402-fetch.ts` detects seller network = Algorand.
4. Desktop wallet pays directly from local Algorand wallet.
5. Request is retried.
6. Response is returned to the user.

### B. Non-Algorand API Flow

1. User has Algorand USDC in the local wallet or an Algorand-backed Pixa backend balance.
2. API returns `402 Payment Required`.
3. `x402-fetch.ts` detects seller network = Base or another supported non-Algorand chain.
4. Desktop sends the payment job to **Pixa Hub**.
5. Pixa Hub verifies the user has enough backend-tracked Algorand-backed balance.
6. Pixa Hub pays the seller from its **native treasury wallet** on the seller chain.
7. Desktop retries the original request using the hub payment result.
8. User gets the API response.
9. Pixa debits the user's backend balance ledger.

### MVP Scope

For MVP:

- direct local Algorand payments
- hub-paid Base payments
- one search flow via Bazaar
- one paid Base seller/API

---

## 4. Architecture

### Desktop Repo: `x402-wallet-for-claude-desktop`

This remains the local agent wallet and router.

Responsibilities:

- parse `402`
- classify seller network
- pay locally for Algorand sellers
- send non-Algorand payment jobs to hub
- retry the original request after hub payment

### Hub Repo: `pixa-cross-chain-hub`

This becomes a **treasury payment service**, not a bridge orchestrator.

Responsibilities:

- maintain prefunded native wallets
- verify user balance availability
- pay sellers on the requested native chain
- return payment execution result back to desktop
- maintain internal treasury and user-balance accounting
- own the authoritative backend balance ledger for MVP

### Balance Model

There are two layers:

- **User balance layer:** Algorand wallet + backend balance ledger/accounting
- **Treasury liquidity layer:** prefunded native chain wallets, starting with Base

---

## 5. What We Keep

### Keep in Desktop Repo

- `src/tools/x402-fetch.ts`
- `src/core/networks.ts`
- `src/core/router.ts`
- `src/clients/hub-client.ts`
- `src/clients.ts`
- `src/config.ts`
- `src/types.ts`

### Keep but Treat as Legacy Compatibility

These can stay in the codebase without being the center of new work:

- local Stellar code paths
- local EVM/Base code paths

That means:

- do not delete them now
- do not design the new architecture around them
- do not spend Phase 2 time extending them

---

## 6. What We Cut

### Cut from the Active Architecture

The following ideas are no longer part of the product design:

- Allbridge in the payment path
- Wormhole in the payment path
- bridge quote logic for every request
- standard bridge mode
- premium bridge mode
- cross-chain settlement as part of the request lifecycle
- Inngest-driven long-running bridge orchestration

### Why We Cut Them

- bridge latency breaks agent UX
- bridge fees break micropayment economics
- x402 still needs native payment on the seller chain
- treasury floats solve the real problem more directly

---

## 7. What We Will Delete from the Folder

### Delete from `pixa-cross-chain-hub`

These files belong to the old bridge-first design and should be removed:

- `pixa-cross-chain-hub/src/bridge/factory.ts`
- `pixa-cross-chain-hub/src/bridge/fake-provider.ts`
- `pixa-cross-chain-hub/src/bridge/provider.ts`
- `pixa-cross-chain-hub/src/bridge/wormhole-provider.ts`
- `pixa-cross-chain-hub/src/inngest/client.ts`
- `pixa-cross-chain-hub/src/inngest/functions/premium-express.ts`
- `pixa-cross-chain-hub/src/inngest/functions/standard-bridge.ts`

### Delete from Hub Dependencies

Remove bridge/workflow dependencies that are only there for the old model:

- `inngest`
- `@wormhole-foundation/*`
- any remaining bridge SDK packages

### Optional Cleanup

If you want a cleaner repo later, also remove:

- `inngest-skills/`

That folder is not product code. It is only reference material.

---

## 8. What We Will Add

### Add to `x402-wallet-for-claude-desktop`

No major new subsystem is needed beyond the router pattern already started.

Add or finish:

- Algorand-first route handling in `src/tools/x402-fetch.ts`
- hub request payload for non-Algorand sellers
- correlation ID and safe retry metadata
- clear errors for unsupported seller networks

### Add to `pixa-cross-chain-hub`

Add a treasury-oriented service shape:

```text
pixa-cross-chain-hub/
  src/
    index.ts
    api/
      pay.ts
      balance.ts
    treasury/
      base-wallet.ts
      accounting.ts
      limits.ts
    x402/
      pay-seller.ts
      verify-user-balance.ts
```

### New Hub Components

- `api/pay.ts`
  - receives non-Algorand payment requests from desktop
- `api/balance.ts`
  - optional balance/health endpoint
- `treasury/base-wallet.ts`
  - manages Base signing and payment submission
- `treasury/accounting.ts`
  - records treasury usage vs user balance debits
- `treasury/limits.ts`
  - risk checks and spend limits
- `x402/pay-seller.ts`
  - chain-specific seller payment execution
- `x402/verify-user-balance.ts`
  - confirms the user can spend before treasury funds are used

---

## 9. Current Repo Changes Needed

### Desktop Repo

- Fix `src/types.ts` so `WalletFileConfig` includes `algorandMnemonic`
- Keep `src/core/networks.ts` based on seller CAIP-2 IDs
- Keep `src/core/router.ts` with two real paths:
  - `LOCAL_ALGORAND`
  - `HUB_TREASURY_PAY`
- Modify `src/tools/x402-fetch.ts` so hub requests match the real hub API contract
- Ensure hub responses contain what the desktop actually needs to retry the original request

### Hub Repo

- Replace the current bridge-oriented `src/index.ts` flow with a direct treasury pay flow
- Remove async bridge job assumptions
- Return a usable payment result to desktop instead of queue-only responses
- Start with **Base only** as the first non-Algorand treasury chain

---

## 10. API Contract We Need

### Desktop -> Hub Request

```ts
type HubPayRequest = {
  correlationId: string
  sellerNetwork: string
  paymentRequirements: unknown
  originalRequest: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }
  userContext: {
    algorandAddress: string
    maxDebitAtomic: string
  }
}
```

### Hub -> Desktop Response

```ts
type HubPayResponse = {
  success: boolean
  paymentSignature?: string
  settlementNetwork?: string
  transactionId?: string
  error?: string
}
```

The desktop must not call the hub and receive a queue acknowledgment only.
It needs a response that can actually complete the x402 retry flow.

---

## 11. Implementation Order

### Step 1: Stabilize Desktop Baseline

- fix `algorandMnemonic` typing bug
- keep router focused on Algorand local pay vs hub pay
- verify Bazaar -> `x402-fetch.ts` -> retry loop locally

### Step 2: Simplify the Hub

- remove bridge/provider/inngest architecture
- implement one synchronous hub pay endpoint
- support **Base** only

### Step 3: Add Treasury Accounting

- record user debit amount
- record treasury spend amount
- add simple spend/risk checks

### Step 4: Test One End-to-End Flow

- search via Bazaar
- hit one paid Base API
- desktop routes to hub
- hub pays with Base treasury wallet
- desktop retries and returns response

### Step 5: Operate Manually

For MVP:

- manually top up the Base treasury wallet
- manually reconcile treasury if needed
- do not build auto-rebalancing yet

---

## 12. What We Are Not Building Now

Not in MVP:

- automated bridging
- automated treasury rebalancing
- Allbridge
- Wormhole
- Inngest workflows
- multi-destination-chain treasury from day one
- generalized chain abstraction for every ecosystem
- user-side multi-wallet support

This is deliberate scope control, not missing work.

---

## 13. Production View

This architecture is not only an MVP shortcut.
It also makes sense for early production if the focus is micropayments.

Use this MVP mental model:

- treasury floats on seller chains
- Algorand as the user funding layer
- backend ledger as the accounting layer
- bridge or CCTP only later for treasury operations if needed

This is much closer to how serious financial systems think about liquidity:

- fast native payout rail
- internal ledger
- treasury rebalancing as back-office ops

---

## 14. Success Criteria

Phase 2 is successful when:

- user only needs Algorand USDC locally
- Algorand seller APIs can be paid locally
- Base seller APIs can be paid by hub treasury
- user balances can be tracked entirely by backend ledger for MVP
- Bazaar can find one paid API and complete one paid response end-to-end
- no bridge is required in the request path

---

## 15. Final Summary

### Best Approach

The better approach is:

- **Algorand-funded user wallet**
- **backend ledger for user balances**
- **native treasury wallet on Base**
- **no bridge in the live payment path**

### What We Delete

- bridge providers
- bridge workflows
- Inngest-based payment orchestration

### What We Add

- treasury payment API
- treasury accounting
- direct Base payment execution from hub

### What We Keep

- existing desktop router work
- existing local Algorand payment path
- existing local Stellar/Base code only as legacy compatibility

This is the simplest architecture that matches x402, fits micropayments, and can be shipped fast.
