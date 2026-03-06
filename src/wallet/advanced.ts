/**
 * Advanced Wallet Features — Phase 9
 *
 * - Transaction history (recent tx lookup via Indexer)
 * - Asset opt-in (required for receiving ASAs on Algorand)
 * - Multi-asset balance display
 * - Network status/health check
 */

import algosdk from "algosdk";
import { createAlgodClient, createIndexerClient } from "./queries.js";

// --- Types ---

export interface TxHistoryEntry {
  txId: string;
  type: string;           // "pay" | "axfer" | "appl" | ...
  direction: "sent" | "received" | "self" | "other";
  amount: number;
  asset: string;          // "ALGO" | "USDC" | "ASA-{id}"
  counterparty: string;   // the other address
  round: number;
  timestamp: number;
}

export interface AssetHolding {
  assetId: number;
  name: string;
  unitName: string;
  amount: number;         // display units
  decimals: number;
  isFrozen: boolean;
}

export interface NetworkStatus {
  network: string;
  healthy: boolean;
  lastRound: number;
  catchupTime: number;
  version: string;
  genesisId: string;
}

// --- Well-known ASA names ---

const KNOWN_ASSETS: Record<number, { name: string; unitName: string; decimals: number }> = {
  0: { name: "Algorand", unitName: "ALGO", decimals: 6 },
  31566704: { name: "USDC", unitName: "USDC", decimals: 6 },
  10458941: { name: "USDC (Testnet)", unitName: "USDC", decimals: 6 },
  312769: { name: "Tether USDt", unitName: "USDT", decimals: 6 },
  386195940: { name: "goETH", unitName: "goETH", decimals: 8 },
  386192725: { name: "goBTC", unitName: "goBTC", decimals: 8 },
};

// --- Transaction History ---

/**
 * Fetch recent transaction history for a wallet address.
 */
export async function getTransactionHistory(
  address: string,
  network: "testnet" | "mainnet",
  limit = 10
): Promise<TxHistoryEntry[]> {
  const indexer = createIndexerClient(network);

  const result = await indexer
    .lookupAccountTransactions(address)
    .limit(limit)
    .do();

  const txns = (result as any).transactions ?? [];
  const history: TxHistoryEntry[] = [];

  for (const tx of txns) {
    const type = tx["tx-type"] ?? "unknown";
    let direction: TxHistoryEntry["direction"] = "other";
    let amount = 0;
    let asset = "ALGO";
    let counterparty = "";

    if (type === "pay") {
      const ptx = tx["payment-transaction"] ?? {};
      const receiver = ptx.receiver ?? "";
      amount = Number(ptx.amount ?? 0) / 1_000_000;
      asset = "ALGO";

      if (tx.sender === address && receiver === address) {
        direction = "self";
        counterparty = address;
      } else if (tx.sender === address) {
        direction = "sent";
        counterparty = receiver;
      } else if (receiver === address) {
        direction = "received";
        counterparty = tx.sender;
      }
    } else if (type === "axfer") {
      const atx = tx["asset-transfer-transaction"] ?? {};
      const receiver = atx.receiver ?? "";
      const assetId = Number(atx["asset-id"] ?? 0);
      const knownAsset = KNOWN_ASSETS[assetId];
      const decimals = knownAsset?.decimals ?? 0;
      amount = Number(atx.amount ?? 0) / Math.pow(10, decimals);
      asset = knownAsset?.unitName ?? `ASA-${assetId}`;

      if (tx.sender === address && receiver === address) {
        direction = "self";
        counterparty = address;
      } else if (tx.sender === address) {
        direction = "sent";
        counterparty = receiver;
      } else if (receiver === address) {
        direction = "received";
        counterparty = tx.sender;
      }
    } else {
      counterparty = tx.sender === address ? "app" : tx.sender;
    }

    history.push({
      txId: tx.id,
      type,
      direction,
      amount,
      asset,
      counterparty,
      round: tx["confirmed-round"] ?? 0,
      timestamp: tx["round-time"] ?? 0,
    });
  }

  return history;
}

// --- Multi-asset Balance ---

/**
 * Get full asset holdings for a wallet address, including ALGO and all ASAs.
 */
export async function getAssetHoldings(
  address: string,
  network: "testnet" | "mainnet"
): Promise<AssetHolding[]> {
  const algod = createAlgodClient(network);
  const holdings: AssetHolding[] = [];

  try {
    const info = await algod.accountInformation(address).do();
    const account = info as any;

    // ALGO balance
    const algoBalance = Number(account.amount ?? 0) / 1_000_000;
    holdings.push({
      assetId: 0,
      name: "Algorand",
      unitName: "ALGO",
      amount: algoBalance,
      decimals: 6,
      isFrozen: false,
    });

    // ASA holdings
    const assets = account.assets ?? [];
    for (const a of assets) {
      const assetId = Number(a["asset-id"]);
      const known = KNOWN_ASSETS[assetId];
      const decimals = known?.decimals ?? 0;
      holdings.push({
        assetId,
        name: known?.name ?? `ASA ${assetId}`,
        unitName: known?.unitName ?? `ASA-${assetId}`,
        amount: Number(a.amount ?? 0) / Math.pow(10, decimals),
        decimals,
        isFrozen: a["is-frozen"] ?? false,
      });
    }
  } catch (err: any) {
    throw new Error(`Failed to fetch holdings: ${err.message}`);
  }

  return holdings;
}

// --- Asset Opt-in ---

/**
 * Build an asset opt-in transaction (zero-amount transfer to self).
 * Required before receiving any ASA on Algorand.
 */
export async function buildOptInTransaction(
  address: string,
  assetId: number,
  network: "testnet" | "mainnet"
): Promise<algosdk.Transaction> {
  const algod = createAlgodClient(network);
  const params = await algod.getTransactionParams().do();

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    assetIndex: assetId,
    amount: 0,
    suggestedParams: params,
  });
}

// --- Network Status ---

/**
 * Check Algorand network health and status.
 */
export async function getNetworkStatus(
  network: "testnet" | "mainnet"
): Promise<NetworkStatus> {
  const algod = createAlgodClient(network);

  try {
    const status = await algod.status().do();
    const s = status as any;

    // algod v2 returns camelCase or kebab-case depending on SDK version
    const lastRound = Number(
      s["last-round"] ?? s.lastRound ?? s["lastRound"] ?? 0
    );
    const catchupTime = Number(
      s["catchup-time"] ?? s.catchupTime ?? 0
    );
    const genesisId = String(
      s["genesis-id"] ?? s.genesisId ?? "unknown"
    );

    return {
      network,
      healthy: lastRound > 0,
      lastRound,
      catchupTime,
      version: genesisId,
      genesisId,
    };
  } catch (err: any) {
    return {
      network,
      healthy: false,
      lastRound: 0,
      catchupTime: 0,
      version: "unavailable",
      genesisId: "unavailable",
    };
  }
}
