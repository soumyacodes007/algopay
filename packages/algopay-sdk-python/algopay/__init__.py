"""
Algopay Python SDK
==================
Drop-in x402 payment decorator for FastAPI/Flask endpoints on Algorand.

Usage:
    from algopay import paywall

    @app.get("/api/data")
    @paywall(price=0.05, pay_to="YOUR_ALGORAND_ADDRESS")
    async def my_endpoint(request: Request):
        return {"data": "paid content"}

Set ALGOPAY_WALLET_ADDRESS env var to avoid passing pay_to every time.
"""

from .paywall import paywall, PaywallConfig, AlgopayVerificationError

__all__ = ["paywall", "PaywallConfig", "AlgopayVerificationError"]
__version__ = "0.1.0"
