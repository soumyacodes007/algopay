"""
Example FastAPI server paywalled with @algopay/paywall
Run with: uvicorn example_fastapi:app --reload

Test (no payment):
    curl http://localhost:8000/api/weather
    → HTTP 402 with X-Payment challenge

Test (with payment proof):
    curl -H "Authorization: x402 eyJ0eElkIjoiVEVTVF9UWF9JRCIsIm5ldHdvcmsiOiJhbGdvcmFuZC10ZXN0bmV0IiwiYXNzZXQiOiJVU0RDIn0=" \
         http://localhost:8000/api/weather
"""

import os
from fastapi import FastAPI, Request

# Add parent packages dir to path for local dev
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from algopay import paywall

app = FastAPI(
    title="Algopay x402 Example",
    description="FastAPI endpoints paywalled via Algorand USDC",
    version="0.1.0",
)

# Your Algorand wallet address (or use ALGOPAY_WALLET_ADDRESS env var)
PAY_TO = os.environ.get(
    "ALGOPAY_WALLET_ADDRESS",
    "TESTINGGYWBBFR6MT3EZLLVYLZZOKWXKDPBEIJEBMRCJJCN2O3VQ"
)

NETWORK = os.environ.get("ALGOPAY_NETWORK", "algorand-testnet")


@app.get("/")
async def root():
    return {
        "service": "Algopay x402 Example Server",
        "endpoints": [
            {"path": "/api/weather", "price": "$0.05 USDC"},
            {"path": "/api/insights", "price": "$0.25 USDC"},
            {"path": "/api/data", "price": "$0.10 USDC"},
        ],
        "network": NETWORK,
        "pay_to": PAY_TO,
    }


@app.get("/api/weather")
@paywall(
    price=0.05,
    pay_to=PAY_TO,
    network=NETWORK,
    description="Real-time weather data for any city",
)
async def weather(request: Request):
    """Pay $0.05 USDC → get weather data."""
    return {
        "city": "San Francisco",
        "temp": 18,
        "unit": "C",
        "condition": "Partly cloudy",
        "humidity": 72,
        "wind_kmh": 15,
    }


@app.get("/api/insights")
@paywall(
    price=0.25,
    pay_to=PAY_TO,
    network=NETWORK,
    description="AI-generated market intelligence signals",
)
async def market_insights(request: Request):
    """Pay $0.25 USDC → get AI market insights."""
    return {
        "signal": "bullish",
        "confidence": 0.87,
        "assets": ["ALGO", "USDC"],
        "reasoning": "Volume spike + positive sentiment index",
        "generated_at": "2026-03-16T01:05:03Z",
    }


@app.get("/api/data")
@paywall(
    price=0.10,
    pay_to=PAY_TO,
    network=NETWORK,
    description="On-chain Algorand DeFi analytics",
)
async def defi_data(request: Request):
    """Pay $0.10 USDC → get DeFi protocol metrics."""
    # Access payment info injected by @paywall
    algopay_info = getattr(request.state, "algopay", {})
    return {
        "tvl_usdc": 42_000_000,
        "daily_volume_usdc": 1_200_000,
        "protocols": ["Tinyman", "Humble", "Vestige"],
        "paid_via_tx": algopay_info.get("tx_id", "n/a"),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
