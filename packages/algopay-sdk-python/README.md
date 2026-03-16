# algopay — Python SDK

> **Stripe for AI Agents** · x402 payment gate for FastAPI & Flask · Algorand USDC

Add a one-line paywall to any Python API endpoint. AI agents and humans pay per-request in USDC on Algorand — no subscriptions, no API keys.

## Install

```bash
pip install algopay           # stdlib only (sync/Flask)
pip install algopay[fastapi]  # + aiohttp for async FastAPI
pip install algopay[flask]    # + flask helpers
pip install algopay[all]      # everything
```

## Quick Start — FastAPI

```python
from fastapi import FastAPI, Request
from algopay import paywall

app = FastAPI()

PAY_TO = "YOUR_ALGORAND_ADDRESS_HERE"  # or set ALGOPAY_WALLET_ADDRESS env var

@app.get("/api/weather")
@paywall(price=0.05, pay_to=PAY_TO, description="Current weather data")
async def weather(request: Request):
    return {"temp": 22, "unit": "C", "city": "San Francisco"}

@app.get("/api/insights")
@paywall(price=0.25, pay_to=PAY_TO, description="AI-generated market insights")
async def insights(request: Request):
    return {"signal": "bullish", "confidence": 0.87}
```

## Quick Start — Flask

```python
from flask import Flask, jsonify
from algopay import paywall

app = Flask(__name__)

@app.route("/api/data")
@paywall(price=0.10, pay_to="YOUR_ALGORAND_ADDRESS_HERE")
def data():
    return jsonify({"value": 42})
```

## How it Works

1. **Request arrives** at your paywalled endpoint
2. **No payment header?** → Returns `HTTP 402` with `X-Payment` challenge header showing where/how to pay
3. **Client pays** the required USDC amount on Algorand
4. **Client retries** with `Authorization: x402 <base64({"txId": "..."})`
5. **Algopay verifies** the payment on-chain via Algorand Indexer
6. **Request passes** through to your handler ✅

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `price` | `float` | required | Price in USDC (e.g. `0.05` = $0.05) |
| `pay_to` | `str` | `ALGOPAY_WALLET_ADDRESS` env var | Your Algorand address |
| `network` | `str` | `algorand-testnet` | `algorand-testnet` or `algorand-mainnet` |
| `description` | `str` | `""` | Shown to payers in 402 response |
| `replay_window_sec` | `int` | `300` | Anti-replay window in seconds |
| `indexer_url` | `str` | AlgoNode public | Custom Indexer endpoint |
| `indexer_token` | `str` | `""` | Token for authenticated Indexers |

## Environment Variables

```bash
ALGOPAY_WALLET_ADDRESS=YOUR_ALGORAND_ADDRESS  # default pay_to
```

## 402 Response Format

```json
{
  "error": "Payment Required",
  "x402": true,
  "payment": {
    "price_usdc": 0.05,
    "pay_to": "ALGO_ADDRESS...",
    "network": "algorand-testnet",
    "asset_id": 10458941
  },
  "instructions": [
    "1. Transfer the required USDC amount to the 'pay_to' address on Algorand",
    "2. Retry with: Authorization: x402 <base64(JSON{txId, network, asset})>"
  ]
}
```

## License

MIT
