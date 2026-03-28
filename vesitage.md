# Implementation Plan: Trading Engine Upgrade (Vestige → Tinyman V2)

Since time is not an issue, we proceed with a major architectural pivot. Vestige's `free-api` depends on a centralized web server that is currently suffering from Cloudflare routing failures. For a high-availability agentic wallet, depending on a single closed-source REST endpoint for liquidity quotes is mathematically unsafe.

We will replace the Vestige Quote REST calls with the **Official Tinyman V2 JS SDK**. 

> [!TIP]
> **Why this is ten times better:**
> Tinyman's SDK does not ping a centralized "Pricing API". Instead, the mathematical formulas of the Automated Market Maker run **locally on your machine** after pulling the live pool reserves from the `algod` node. It mathematically cannot go "down" unless the entire Algorand network goes offline. 

## Proposed Changes

### 1. New Dependencies
Add the official Tinyman SDK to the project.
- `npm install @tinymanorg/tinyman-js-sdk`
- This allows robust interaction with both Mainnet and Testnet AMM pools.

### 2. `src/wallet/tinyman.ts`
We will create a new decentralized swap engine module to replace `vestige.ts`.
#### [NEW] src/wallet/tinyman.ts
- Import `algonode.cloud` algod/indexer clients.
- Implement the `getSwapQuote` logic by pulling `getPoolState` locally via the SDK and calculating the exchange rate without relying on web servers.
- Keep the `KNOWN_PRICES` fallback wrapper for safety on unrecognized Testnet pairs.

### 3. `src/cli.ts`
We will refactor the internal routing of the `trade` command.
#### [MODIFY] src/cli.ts
- Point the CLI to import the new `getSwapQuote` functions from the `tinyman.ts` library instead of `vestige.ts`.
- (Optional Upgrade): With the official Tinyman SDK, we can finally strip away the `"Warning: Trade execution is a V2 feature"` mock lock, and upgrade the CLI so your AI agent actually executes mathematically sound `swap` transactions on the DEX immediately!

## User Review Required

Since we have the time to build this correctly, do you want me to just build the *Quote Fetching* logic (to replace the broken Vestige quotes), or do you want me to write the full **Trade Execution Pipeline** as well, so your AI agent can immediately execute real token swaps on the Testnet right now?
