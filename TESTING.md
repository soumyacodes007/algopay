# Testing Guide

This repository uses **Vitest** for fast unit and integration-style testing of the MCP wallet, x402 flows, routing logic, and app tooling.

## Quick commands

Run the full automated suite:

```bash
npm test
```

Run tests in watch mode while developing:

```bash
npm run test:watch
```

Build the project before packaging or releasing:

```bash
npm run build
```

## What is covered

The current suite focuses on the highest-risk logic for the technical panel:

- **Config and wallet modes**
  - key detection
  - network defaults
  - budget reloading
- **Balance reporting**
  - no-wallet guardrails
  - EVM response formatting
  - Algorand-specific ALGO + USDC reporting
- **x402 payment creation**
  - budget enforcement
  - stellar, base, and algorand payment payloads
  - error handling when signing fails
- **x402 paid fetch flow**
  - free responses
  - native Algorand x402 retry
  - cross-chain hub retry
  - missing payment options
  - spending-limit enforcement
  - network failure handling
- **Routing**
  - native Algorand routing
  - hub routing for supported seller chains
  - unsupported / non-routable seller networks
- **Onramp MCP app**
  - hosted browser-launch payload
  - input validation
  - resource HTML + CSP metadata
- **Pera rekey flow**
  - address validation
  - unsigned rekey transaction preparation
  - structured payload generation for the app
- **Wallet store and spending tracker**
  - local persistence behavior
  - session spending history and budget math

## Test matrix

### 1. Unit tests

These validate small pieces of deterministic logic:

- config parsing
- route selection
- spending tracker logic
- wallet-store reads and writes

### 2. Integration-style tests

These test full tool handlers with mocked dependencies:

- `pay`
- `x402_fetch`
- `check_balance`
- `open_onramp`
- `rekey_with_pera`

This gives us confidence that tool registration, validation, response formatting, and edge-case handling work end to end without needing live wallets or live chains during every test run.

## Manual verification checklist

Automated tests do not replace the demo verification steps. Before a pitch or release:

1. Run `npm test`
2. Run `npm run build`
3. Verify one real `x402_fetch` payment flow
4. Verify one real onramp browser handoff
5. Verify one real rekey preview flow in the hosted/browser environment
6. Rebuild the `.mcpb` bundle only after the suite is green

## Known boundaries

The automated suite intentionally mocks:

- partner APIs
- onramp browser handoff
- Pera wallet signing
- hub settlement responses
- blockchain RPC responses

That means the suite is strongest at validating **our logic and edge cases**, while manual smoke tests remain important for:

- wallet UX
- external browser flows
- hosted pages
- live chain connectivity
- real partner availability

## Why this matters for the technical panel

This setup demonstrates:

- working automated tests
- clear edge-case coverage
- explicit boundaries between unit tests, integration-style tests, and manual smoke tests
- a documented process for verifying the code before demos and releases
