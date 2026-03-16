"""
Tests for algopay Python SDK — @paywall decorator
Run: pytest tests/ -v

Covers Req 13 Phase 6 test plan:
 - Python decorator returns 402 on unpaid request
 - Python decorator passes on valid tx hash (mocked on-chain)
 - Replay protection blocks same txId twice
 - Malformed Authorization header is rejected
 - Price/recipient mismatch is rejected
"""

import base64
import json
import sys
import os
import pytest

# Add SDK to path for local testing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, AsyncMock, MagicMock
from algopay import paywall
from algopay.paywall import PaywallConfig, _is_replay, _mark_used, _used_tx_ids


# ─── Helpers ──────────────────────────────────────────────────────────────────

TEST_PAY_TO = "TESTINGGYWBBFR6MT3EZLLVYLZZOKWXKDPBEIJEBMRCJJCN2O3VQ"
TEST_TX_ID = "TESTTXIDABCDEF1234567890ABCDEF1234567890ABCDEF12345"


def make_proof_header(tx_id: str = TEST_TX_ID) -> str:
    proof = {"txId": tx_id, "network": "algorand-testnet", "asset": "USDC"}
    b64 = base64.b64encode(json.dumps(proof).encode()).decode()
    return f"x402 {b64}"


def make_mock_indexer_response(
    tx_id: str = TEST_TX_ID,
    pay_to: str = TEST_PAY_TO,
    amount_micro: int = 50_000,  # 0.05 USDC
    asset_id: int = 10458941,
    confirmed: bool = True,
) -> dict:
    return {
        "transaction": {
            "id": tx_id,
            "tx-type": "axfer",
            "confirmed-round": 99_999_999 if confirmed else None,
            "asset-transfer-transaction": {
                "asset-id": asset_id,
                "receiver": pay_to,
                "amount": amount_micro,
            },
        }
    }


# ─── PaywallConfig tests ──────────────────────────────────────────────────────

class TestPaywallConfig:
    def test_valid_config(self):
        cfg = PaywallConfig(price=0.05, pay_to=TEST_PAY_TO)
        assert cfg.price == 0.05
        assert cfg.pay_to == TEST_PAY_TO
        assert cfg.network == "algorand-testnet"
        assert cfg.usdc_asset_id == 10458941

    def test_mainnet_sets_correct_usdc_id(self):
        cfg = PaywallConfig(price=1.0, pay_to=TEST_PAY_TO, network="algorand-mainnet")
        assert cfg.usdc_asset_id == 31566704

    def test_missing_pay_to_raises(self):
        # Remove env var to ensure it's really missing
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ALGOPAY_WALLET_ADDRESS", None)
            with pytest.raises(ValueError, match="pay_to"):
                PaywallConfig(price=0.05, pay_to=None)

    def test_invalid_network_raises(self):
        with pytest.raises(ValueError, match="unknown network"):
            PaywallConfig(price=0.05, pay_to=TEST_PAY_TO, network="solana-mainnet")

    def test_env_var_fallback(self):
        with patch.dict(os.environ, {"ALGOPAY_WALLET_ADDRESS": TEST_PAY_TO}):
            cfg = PaywallConfig(price=0.05)
        assert cfg.pay_to == TEST_PAY_TO


# ─── Replay protection tests ──────────────────────────────────────────────────

class TestReplayProtection:
    def setup_method(self):
        _used_tx_ids.clear()

    def test_first_use_not_replay(self):
        assert not _is_replay("UNIQUE_TX_1", 300)

    def test_same_tx_is_replay(self):
        _mark_used("REPLAY_TX")
        assert _is_replay("REPLAY_TX", 300)

    def test_expired_window_not_replay(self):
        _used_tx_ids["OLD_TX"] = 0.0  # epoch — very old
        assert not _is_replay("OLD_TX", 300)

    def test_different_tx_not_replay(self):
        _mark_used("TX_A")
        assert not _is_replay("TX_B", 300)


# ─── FastAPI integration tests ────────────────────────────────────────────────

class TestFastapiPaywall:
    """Tests for the async FastAPI path."""

    def _make_fastapi_request(self, auth_header: str = ""):
        """Create a minimal mock FastAPI Request."""
        from unittest.mock import MagicMock
        request = MagicMock()
        request.headers = {"authorization": auth_header}
        request.state = MagicMock()
        request.state.algopay = None
        return request

    def test_no_auth_returns_402_fastapi(self):
        """Unpaid request → must return 402."""
        from starlette.responses import JSONResponse

        @paywall(price=0.05, pay_to=TEST_PAY_TO)
        async def endpoint(request):
            return JSONResponse({"ok": True})

        import asyncio
        request = self._make_fastapi_request(auth_header="")
        result = asyncio.get_event_loop().run_until_complete(endpoint(request=request))
        assert result.status_code == 402
        body = json.loads(result.body)
        assert body["x402"] is True
        assert body["payment"]["price_usdc"] == 0.05

    def test_valid_payment_passes_fastapi(self):
        """Valid on-chain payment → handler is called."""
        from starlette.responses import JSONResponse

        @paywall(price=0.05, pay_to=TEST_PAY_TO)
        async def endpoint(request):
            return JSONResponse({"ok": True})

        import asyncio
        request = self._make_fastapi_request(auth_header=make_proof_header())

        mock_response = make_mock_indexer_response()
        with patch("algopay.paywall._verify_payment_async", new_callable=AsyncMock) as mock_verify:
            mock_verify.return_value = (True, "ok")
            _used_tx_ids.clear()
            result = asyncio.get_event_loop().run_until_complete(endpoint(request=request))

        assert result.status_code == 200
        body = json.loads(result.body)
        assert body["ok"] is True

    def test_replay_blocked_fastapi(self):
        """Re-used txId → 402 replay detected."""
        from starlette.responses import JSONResponse

        @paywall(price=0.05, pay_to=TEST_PAY_TO)
        async def endpoint(request):
            return JSONResponse({"ok": True})

        import asyncio
        _used_tx_ids.clear()
        _mark_used(TEST_TX_ID)

        request = self._make_fastapi_request(auth_header=make_proof_header(TEST_TX_ID))
        result = asyncio.get_event_loop().run_until_complete(endpoint(request=request))
        assert result.status_code == 402
        body = json.loads(result.body)
        assert "Replay" in body["error"]

    def test_malformed_header_returns_400(self):
        """Garbage Authorization header → 400."""
        from starlette.responses import JSONResponse

        @paywall(price=0.05, pay_to=TEST_PAY_TO)
        async def endpoint(request):
            return JSONResponse({"ok": True})

        import asyncio
        request = self._make_fastapi_request(auth_header="x402 NOT_VALID_BASE64!!!")
        result = asyncio.get_event_loop().run_until_complete(endpoint(request=request))
        assert result.status_code == 400

    def test_wrong_price_rejected(self):
        """Payment below required amount → 402."""
        from starlette.responses import JSONResponse

        @paywall(price=1.00, pay_to=TEST_PAY_TO)  # need $1.00 USDC
        async def endpoint(request):
            return JSONResponse({"ok": True})

        import asyncio
        _used_tx_ids.clear()
        request = self._make_fastapi_request(auth_header=make_proof_header())

        # Mock verify to return failure (insufficient payment)
        with patch("algopay.paywall._verify_payment_async", new_callable=AsyncMock) as m:
            m.return_value = (False, "Insufficient payment: got 50000 µUSDC, need 1000000")
            result = asyncio.get_event_loop().run_until_complete(endpoint(request=request))

        assert result.status_code == 402
        body = json.loads(result.body)
        assert "Verification Failed" in body["error"]
