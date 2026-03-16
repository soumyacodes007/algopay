"""
Algopay Python SDK
==================
Drop-in payment decorator for FastAPI/Flask endpoints.

Usage:
    from algopay import paywall

    @app.get("/api/data")
    @paywall(price=0.05, asset="USDC")
    async def my_endpoint():
        return {"data": "paid content"}
"""

from .paywall import paywall, PaywallConfig, AlgopayVerificationError

__all__ = ["paywall", "PaywallConfig", "AlgopayVerificationError"]
__version__ = "0.1.0"
