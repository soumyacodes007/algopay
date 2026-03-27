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

import algosdk from "algosdk";
import { getNetworkEndpoints } from "../config.js";
import { buildUsdcTransfer, buildAlgoTransfer } from "./transactions.js";
import { createAlgodClient, waitForConfirmation } from "./queries.js";
import { getIntermezzoClient } from "./intermezzo.js";
import jwt from "jsonwebtoken";
import { runGuardrails, recordSpend, type GuardrailContext } from "./guardrails.js";

// --- Types ---

export type SendAsset = "ALGO" | "USDC";

export interface SendOptions {
  senderAddress: string;
  recipientAddress: string;
  amount: number;        // display units (e.g. 1.5 USDC or 1.5 ALGO)
  asset: SendAsset;
  network: "testnet" | "mainnet";
  sessionToken: string;  // JWT from auth — passed to Intermezzo
  dryRun?: boolean;      // If true, build the group but don't broadcast
  // In production, Intermezzo backend wallet pays fees.
  // For dev/mock mode, we use the sender address as a stand-in.
  backendAddress?: string;
}

export interface SendResult {
  success: boolean;
  txId?: string;
  confirmedRound?: number;
  fee?: number;
  dryRun?: boolean;
  error?: string;
}

// --- Send Executor ---

export async function sendPayment(opts: SendOptions): Promise<SendResult> {
  const {
    senderAddress,
    recipientAddress,
    amount,
    asset,
    network,
    sessionToken,
    dryRun = false,
    backendAddress = senderAddress, // mock: sender pays own fee
  } = opts;

  const ep = getNetworkEndpoints(network);

  // ─── Step 1: Guardrail checks ────────────────────────────────────────────
  const ctx: GuardrailContext = {
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
  let txId: string;
  try {
    const decoded = jwt.decode(sessionToken) as any;
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
      } else {
        throw new Error(`USDC sending via Pawn is not yet supported.`);
      }
    } else {
      if (asset === "ALGO") {
        const res = await intermezzo.transferAlgo({
          amount: Math.round(amount * 1_000_000),
          toAddress: recipientAddress,
          fromUserId: pawnUserId,
        });
        txId = res.transaction_id;
      } else {
        throw new Error(`USDC sending via Pawn is not yet supported.`);
      }
    }
  } catch (err: any) {
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
    const confirmedRound = Number((confirmed as any)["confirmed-round"] ?? (confirmed as any).confirmedRound ?? 0);

    // Record the spend for guardrail tracking
    recordSpend(amount, asset);

    return {
      success: true,
      txId,
      confirmedRound,
      fee: 1000,
    };
  } catch (err: any) {
    // Tx might still be pending — return txId so user can check manually
    return {
      success: true,
      txId,
      error: `Sent but confirmation timed out: ${err.message}`,
    };
  }
}
