"""
algopay.paywall — @paywall decorator for FastAPI / Flask
=========================================================
Req 13: 1-line API monetization for Algorand

Supports:
  - FastAPI (async, with HTTPException)
  - Flask / WSGI (sync, with abort/Response)
  - On-chain USDC verification via Algorand Indexer
  - Replay attack protection (in-memory txId window)

Usage (FastAPI):
    from algopay import paywall

    @app.get("/api/weather")
    @paywall(price=0.05, pay_to="YOUR_ALGO_ADDRESS")
    async def weather():
        return {"temp": 22}

Usage (Flask):
    from algopay import paywall

    @app.route("/api/data")
    @paywall(price=0.10, pay_to="YOUR_ALGO_ADDRESS")
    def data():
        return jsonify({"value": 42})
"""

from __future__ import annotations

import base64
import functools
import json
import os
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Optional

# ─── USDC asset IDs per network ───────────────────────────────────────────────
USDC_ASSET_IDS = {
    "algorand-testnet": 10458941,
    "algorand-mainnet": 31566704,
}

INDEXER_URLS = {
    "algorand-testnet": "https://testnet-idx.algonode.cloud",
    "algorand-mainnet": "https://mainnet-idx.algonode.cloud",
}

# ─── Config ───────────────────────────────────────────────────────────────────

@dataclass
class PaywallConfig:
    """Configuration for the @paywall decorator."""

    price: float
    """Price per request in USDC (e.g. 0.05 = $0.05)"""

    pay_to: Optional[str] = None
    """Algorand wallet address to receive payments.
    Defaults to ALGOPAY_WALLET_ADDRESS env var."""

    network: str = "algorand-testnet"
    """'algorand-testnet' or 'algorand-mainnet'"""

    asset: str = "USDC"
    """Token to accept: 'USDC' (default) or 'ALGO'"""

    description: str = ""
    """Human-readable description shown in 402 response."""

    indexer_url: Optional[str] = None
    """Algorand Indexer base URL (auto-set from network if not provided)."""

    indexer_token: str = ""
    """Indexer API token (needed for Nodely/paid instances; empty for AlgoNode)."""

    replay_window_sec: int = 300
    """Time window (seconds) in which a txId can only be used once. Default: 5 min."""

    usdc_asset_id: Optional[int] = None
    """Override USDC asset ID (useful for custom/fork networks)."""

    def __post_init__(self):
        if self.pay_to is None:
            self.pay_to = os.environ.get("ALGOPAY_WALLET_ADDRESS")
        if not self.pay_to:
            raise ValueError(
                "paywall: you must supply pay_to= or set ALGOPAY_WALLET_ADDRESS env var"
            )
        if self.network not in USDC_ASSET_IDS:
            raise ValueError(
                f"paywall: unknown network '{self.network}'. "
                f"Use 'algorand-testnet' or 'algorand-mainnet'."
            )
        if self.indexer_url is None:
            self.indexer_url = INDEXER_URLS[self.network]
        if self.usdc_asset_id is None:
            self.usdc_asset_id = USDC_ASSET_IDS[self.network]


# ─── Custom exception ─────────────────────────────────────────────────────────

class AlgopayVerificationError(Exception):
    """Raised when on-chain payment verification fails."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# ─── Replay protection ────────────────────────────────────────────────────────

_used_tx_ids: dict[str, float] = {}
_replay_lock = Lock()


def _is_replay(tx_id: str, window_sec: int) -> bool:
    with _replay_lock:
        now = time.time()
        used_at = _used_tx_ids.get(tx_id)
        if used_at is None:
            return False
        if now - used_at > window_sec:
            del _used_tx_ids[tx_id]
            return False
        return True


def _mark_used(tx_id: str) -> None:
    with _replay_lock:
        _used_tx_ids[tx_id] = time.time()


# ─── On-chain verification ────────────────────────────────────────────────────

def _verify_payment_sync(
    tx_id: str,
    expected_pay_to: str,
    price_usdc: float,
    config: PaywallConfig,
) -> tuple[bool, str]:
    """
    Verify a USDC payment on Algorand Indexer (sync, uses urllib).
    Returns (valid: bool, reason: str).
    """
    import urllib.request
    import urllib.error

    url = f"{config.indexer_url.rstrip('/')}/v2/transactions/{tx_id}"
    req = urllib.request.Request(url)
    if config.indexer_token:
        req.add_header("X-Indexer-API-Token", config.indexer_token)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return False, f"Indexer HTTP error {e.code}: transaction not found"
    except Exception as e:
        return False, f"Indexer request failed: {e}"

    tx = data.get("transaction", data)

    # Must be an asset transfer
    if tx.get("tx-type") != "axfer":
        return False, "Transaction is not an ASA (asset) transfer"

    axfer = tx.get("asset-transfer-transaction", {})

    # Check asset ID
    asset_id = axfer.get("asset-id")
    if int(asset_id or 0) != config.usdc_asset_id:
        return False, f"Wrong asset: expected USDC ({config.usdc_asset_id}), got {asset_id}"

    # Check recipient
    receiver = axfer.get("receiver", "")
    if receiver != expected_pay_to:
        return False, f"Wrong recipient: expected {expected_pay_to}, got {receiver}"

    # Check amount (USDC has 6 decimal places)
    amount = int(axfer.get("amount", 0))
    expected_micro = int(price_usdc * 1_000_000)
    if amount < expected_micro:
        return False, (
            f"Insufficient payment: got {amount} µUSDC, "
            f"need {expected_micro} ({price_usdc} USDC)"
        )

    # Must be confirmed
    if not tx.get("confirmed-round"):
        return False, "Transaction is not yet confirmed on-chain"

    return True, "ok"


async def _verify_payment_async(
    tx_id: str,
    expected_pay_to: str,
    price_usdc: float,
    config: PaywallConfig,
) -> tuple[bool, str]:
    """
    Async version of on-chain verification (uses aiohttp if available,
    falls back to running the sync version in an executor).
    """
    try:
        import aiohttp  # optional dependency

        url = f"{config.indexer_url.rstrip('/')}/v2/transactions/{tx_id}"
        headers = {}
        if config.indexer_token:
            headers["X-Indexer-API-Token"] = config.indexer_token

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return False, f"Indexer HTTP {resp.status}: transaction not found"
                data = await resp.json()

        tx = data.get("transaction", data)

        if tx.get("tx-type") != "axfer":
            return False, "Transaction is not an ASA (asset) transfer"

        axfer = tx.get("asset-transfer-transaction", {})

        asset_id = axfer.get("asset-id")
        if int(asset_id or 0) != config.usdc_asset_id:
            return False, f"Wrong asset: expected USDC ({config.usdc_asset_id}), got {asset_id}"

        receiver = axfer.get("receiver", "")
        if receiver != expected_pay_to:
            return False, f"Wrong recipient: expected {expected_pay_to}, got {receiver}"

        amount = int(axfer.get("amount", 0))
        expected_micro = int(price_usdc * 1_000_000)
        if amount < expected_micro:
            return False, (
                f"Insufficient payment: got {amount} µUSDC, "
                f"need {expected_micro} ({price_usdc} USDC)"
            )

        if not tx.get("confirmed-round"):
            return False, "Transaction is not yet confirmed on-chain"

        return True, "ok"

    except ImportError:
        # aiohttp not available — run sync version in thread pool
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _verify_payment_sync,
            tx_id,
            expected_pay_to,
            price_usdc,
            config,
        )


# ─── 402 Response builders ────────────────────────────────────────────────────

def _build_402_body(config: PaywallConfig) -> dict:
    return {
        "error": "Payment Required",
        "x402": True,
        "payment": {
            "price_usdc": config.price,
            "pay_to": config.pay_to,
            "network": config.network,
            "asset_id": config.usdc_asset_id,
            "description": config.description or "Pay to access this endpoint",
        },
        "instructions": [
            "1. Transfer the required USDC amount to the 'pay_to' address on Algorand",
            "2. Once confirmed, retry with: Authorization: x402 <base64(JSON{txId, network, asset})>",
            "   Example: Authorization: x402 eyJ0eElkIjoiLi4uIn0=",
        ],
    }


def _build_x_payment_header(config: PaywallConfig) -> str:
    return json.dumps({
        "price_usdc": config.price,
        "pay_to": config.pay_to,
        "network": config.network,
        "asset_id": config.usdc_asset_id,
        "description": config.description or "Pay to access this endpoint",
    })


def _parse_proof(auth_header: str) -> Optional[dict]:
    """Parse 'x402 <base64>' Authorization header into proof dict."""
    if not auth_header or not auth_header.startswith("x402 "):
        return None
    try:
        b64 = auth_header[len("x402 "):].strip()
        return json.loads(base64.b64decode(b64).decode("utf-8"))
    except Exception:
        return None


# ─── The @paywall decorator ───────────────────────────────────────────────────

def paywall(
    price: float,
    pay_to: Optional[str] = None,
    network: str = "algorand-testnet",
    asset: str = "USDC",
    description: str = "",
    indexer_url: Optional[str] = None,
    indexer_token: str = "",
    replay_window_sec: int = 300,
    usdc_asset_id: Optional[int] = None,
) -> Callable:
    """
    @paywall — protect any FastAPI or Flask endpoint with an x402 Algorand payment gate.

    Parameters
    ----------
    price               Price per request in USDC (e.g. 0.05 = $0.05)
    pay_to              Your Algorand wallet address. Falls back to ALGOPAY_WALLET_ADDRESS env var.
    network             'algorand-testnet' (default) or 'algorand-mainnet'
    asset               Token to accept: 'USDC' (default)
    description         Human-readable description shown in 402 headers
    indexer_url         Custom Indexer URL (default: AlgoNode public endpoint)
    indexer_token       Indexer token for authenticated nodes
    replay_window_sec   Seconds a txId is valid (anti-replay). Default: 300
    usdc_asset_id       Override USDC asset ID

    Example (FastAPI)
    -----------------
    @app.get("/api/weather")
    @paywall(price=0.05, pay_to="YOURALGORANDADDR...")
    async def weather():
        return {"temp": 22, "unit": "C"}

    Example (Flask)
    ---------------
    @app.route("/api/data")
    @paywall(price=0.10, pay_to="YOURALGORANDADDR...")
    def data():
        return jsonify({"value": 42})
    """
    config = PaywallConfig(
        price=price,
        pay_to=pay_to,
        network=network,
        asset=asset,
        description=description,
        indexer_url=indexer_url,
        indexer_token=indexer_token,
        replay_window_sec=replay_window_sec,
        usdc_asset_id=usdc_asset_id,
    )

    def decorator(func: Callable) -> Callable:
        import asyncio
        import inspect

        is_async = asyncio.iscoroutinefunction(func)

        if is_async:
            # ── FastAPI / async path ──────────────────────────────────────
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                # Try to find the Request object in kwargs (FastAPI injects it)
                request = _extract_request_fastapi(kwargs)
                if request is None:
                    # If no request in kwargs, call through (shouldn't happen normally)
                    return await func(*args, **kwargs)

                auth_header = request.headers.get("authorization", "")
                proof = _parse_proof(auth_header)

                if proof is None:
                    # No payment header → return 402
                    return _fastapi_402(config)

                tx_id = proof.get("txId") or proof.get("tx_id")
                if not tx_id:
                    return _fastapi_400("Missing txId in payment proof")

                if _is_replay(tx_id, config.replay_window_sec):
                    return _fastapi_402_replay()

                valid, reason = await _verify_payment_async(
                    tx_id, config.pay_to, config.price, config
                )
                if not valid:
                    return _fastapi_402_failed(reason)

                _mark_used(tx_id)

                # Inject algopay payment info into request.state
                try:
                    request.state.algopay = {
                        "tx_id": tx_id,
                        "paid_amount": config.price,
                        "network": config.network,
                    }
                except Exception:
                    pass

                return await func(*args, **kwargs)

            return async_wrapper

        else:
            # ── Flask / sync path ─────────────────────────────────────────
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                request = _extract_request_flask()
                if request is None:
                    return func(*args, **kwargs)

                auth_header = request.headers.get("Authorization", "")
                proof = _parse_proof(auth_header)

                if proof is None:
                    return _flask_402(config)

                tx_id = proof.get("txId") or proof.get("tx_id")
                if not tx_id:
                    return _flask_400("Missing txId in payment proof")

                if _is_replay(tx_id, config.replay_window_sec):
                    return _flask_402_replay()

                valid, reason = _verify_payment_sync(
                    tx_id, config.pay_to, config.price, config
                )
                if not valid:
                    return _flask_402_failed(reason)

                _mark_used(tx_id)
                return func(*args, **kwargs)

            return sync_wrapper

    return decorator


# ─── FastAPI helpers ──────────────────────────────────────────────────────────

def _extract_request_fastapi(kwargs: dict) -> Any:
    """Find a FastAPI Request object in kwargs."""
    try:
        from starlette.requests import Request
        for v in kwargs.values():
            if isinstance(v, Request):
                return v
        # Also try positional-style injection name
        return kwargs.get("request")
    except ImportError:
        return kwargs.get("request")


def _fastapi_402(config: PaywallConfig):
    try:
        from starlette.responses import JSONResponse
        body = _build_402_body(config)
        return JSONResponse(
            content=body,
            status_code=402,
            headers={"X-Payment": _build_x_payment_header(config)},
        )
    except ImportError:
        raise AlgopayVerificationError("Payment required — install fastapi/starlette")


def _fastapi_400(msg: str):
    try:
        from starlette.responses import JSONResponse
        return JSONResponse(content={"error": msg}, status_code=400)
    except ImportError:
        raise AlgopayVerificationError(msg)


def _fastapi_402_replay():
    try:
        from starlette.responses import JSONResponse
        return JSONResponse(
            content={
                "error": "Payment Replay Detected",
                "message": "This transaction has already been used. Submit a new payment.",
            },
            status_code=402,
        )
    except ImportError:
        raise AlgopayVerificationError("Replay detected")


def _fastapi_402_failed(reason: str):
    try:
        from starlette.responses import JSONResponse
        return JSONResponse(
            content={"error": "Payment Verification Failed", "reason": reason},
            status_code=402,
        )
    except ImportError:
        raise AlgopayVerificationError(reason)


# ─── Flask helpers ────────────────────────────────────────────────────────────

def _extract_request_flask() -> Any:
    try:
        from flask import request
        return request
    except ImportError:
        return None


def _flask_402(config: PaywallConfig):
    try:
        from flask import jsonify, make_response
        body = _build_402_body(config)
        resp = make_response(jsonify(body), 402)
        resp.headers["X-Payment"] = _build_x_payment_header(config)
        return resp
    except ImportError:
        raise AlgopayVerificationError("Payment required — install flask")


def _flask_400(msg: str):
    try:
        from flask import jsonify, make_response
        return make_response(jsonify({"error": msg}), 400)
    except ImportError:
        raise AlgopayVerificationError(msg)


def _flask_402_replay():
    try:
        from flask import jsonify, make_response
        return make_response(jsonify({
            "error": "Payment Replay Detected",
            "message": "This transaction has already been used. Submit a new payment.",
        }), 402)
    except ImportError:
        raise AlgopayVerificationError("Replay detected")


def _flask_402_failed(reason: str):
    try:
        from flask import jsonify, make_response
        return make_response(jsonify({
            "error": "Payment Verification Failed",
            "reason": reason,
        }), 402)
    except ImportError:
        raise AlgopayVerificationError(reason)
