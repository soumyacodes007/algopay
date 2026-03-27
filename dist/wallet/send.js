/**
 * Send Module — Executes fee-pooled transactions via Intermezzo
 * Reqs: 8 (send USDC), 28 (tx confirmation), 33 (fee pooling)
 *
 * Flow:
 *   1. Guardrails checks (address, limits)
 *   2. Build atomic group (user tx + fee tx)
 *   3. Intermezzo signs user tx + backend signs fee tx
 *   4. Broadcast to Algorand
 *   5. Wait for confirmation
 */
import { getNetworkEndpoints } from "../config.js";
import { waitForConfirmation } from "./queries.js";
import { getIntermezzoClient } from "./intermezzo.js";
import jwt from "jsonwebtoken";
import { runGuardrails, recordSpend } from "./guardrails.js";
// --- Send Executor ---
export async function sendPayment(opts) {
    const { senderAddress, recipientAddress, amount, asset, network, sessionToken, dryRun = false, backendAddress = senderAddress, // mock: sender pays own fee
     } = opts;
    const ep = getNetworkEndpoints(network);
    // ─── Step 1: Guardrail checks ────────────────────────────────────────────
    const ctx = {
        senderAddress,
        recipientAddress,
        amount,
        asset,
        network,
    };
    const guardrail = runGuardrails(ctx);
    if (!guardrail.allow) {
        return { success: false, error: `Guardrail blocked: ${guardrail.reason}` };
    }
    // ─── Step 2 & 3: Dry run check ──────────────────────────────────────────
    if (dryRun) {
        return {
            success: true,
            dryRun: true,
            fee: 1000,
            txId: "DRY-RUN",
        };
    }
    // ─── Step 4: Execute via Intermezzo (Pawn) ───────────────────────────────
    const intermezzo = getIntermezzoClient();
    let txId;
    try {
        const decoded = jwt.decode(sessionToken);
        const pawnUserId = decoded?.pawnUserId;
        if (!pawnUserId) {
            // Fallback: derive from email if old JWT without pawnUserId
            const email = decoded?.email;
            if (!email) {
                throw new Error(`Invalid session token: unable to determine user identity.`);
            }
            // Sanitize email same way as server.ts
            const fallbackUserId = email.replace(/@/g, "_at_").replace(/\./g, "_");
            if (asset === "ALGO") {
                const res = await intermezzo.transferAlgo({
                    amount: Math.round(amount * 1_000_000),
                    toAddress: recipientAddress,
                    fromUserId: fallbackUserId,
                });
                txId = res.transaction_id;
            }
            else {
                throw new Error(`USDC sending via Pawn is not yet supported.`);
            }
        }
        else {
            if (asset === "ALGO") {
                const res = await intermezzo.transferAlgo({
                    amount: Math.round(amount * 1_000_000),
                    toAddress: recipientAddress,
                    fromUserId: pawnUserId,
                });
                txId = res.transaction_id;
            }
            else {
                throw new Error(`USDC sending via Pawn is not yet supported.`);
            }
        }
    }
    catch (err) {
        return { success: false, error: `Transfer failed: ${err.message}` };
    }
    // If we are in mock mode, immediately resolve
    if (txId.startsWith("MOCK_TX_")) {
        recordSpend(amount, asset);
        return { success: true, txId, confirmedRound: 0, fee: 1000 };
    }
    // ─── Step 6: Wait for confirmation ───────────────────────────────────────
    try {
        const confirmed = await waitForConfirmation(txId, network, 10);
        const confirmedRound = Number(confirmed["confirmed-round"] ?? confirmed.confirmedRound ?? 0);
        // Record the spend for guardrail tracking
        recordSpend(amount, asset);
        return {
            success: true,
            txId,
            confirmedRound,
            fee: 1000,
        };
    }
    catch (err) {
        // Tx might still be pending — return txId so user can check manually
        return {
            success: true,
            txId,
            error: `Sent but confirmation timed out: ${err.message}`,
        };
    }
}
//# sourceMappingURL=send.js.map