/**
 * Wallet Module — Queries Algorand via algosdk + Indexer
 * Reqs: 4 (status), 5 (balance), 6 (address), 20 (history), 26 (network), 27 (confirmation)
 */

import algosdk from "algosdk";
import { getNetworkEndpoints } from "../config.js";

// --- Client factory ---

export function createAlgodClient(network: "testnet" | "mainnet") {
    const ep = getNetworkEndpoints(network);
    return new algosdk.Algodv2(ep.algodToken, ep.algodUrl, "");
}

export function createIndexerClient(network: "testnet" | "mainnet") {
    const ep = getNetworkEndpoints(network);
    return new algosdk.Indexer(ep.indexerToken, ep.indexerUrl, "");
}

// --- Types ---

export interface WalletStatus {
    address: string;
    network: string;
    authenticated: boolean;
    algodStatus: {
        lastRound: number;
        catchupTime: number;
    };
}

export interface AssetBalance {
    assetId: number;
    name: string;
    unitName: string;
    amount: number;
    decimals: number;
    displayAmount: string;
}

export interface WalletBalance {
    address: string;
    network: string;
    algo: {
        amount: number;
        displayAmount: string;
    };
    assets: AssetBalance[];
    totalUsdcBalance: string;
}

export interface TransactionRecord {
    id: string;
    type: string;
    sender: string;
    receiver: string;
    amount: number;
    assetId: number | null;
    fee: number;
    roundTime: number;
    confirmedRound: number;
    note: string;
}

// --- Wallet Queries ---

/**
 * Get wallet status: account info + network status (Req 4)
 */
export async function getStatus(
    address: string,
    network: "testnet" | "mainnet"
): Promise<WalletStatus> {
    const algod = createAlgodClient(network);
    const status = await algod.status().do();

    return {
        address,
        network,
        authenticated: true,
        algodStatus: {
            lastRound: Number((status as any).lastRound ?? (status as any)["last-round"] ?? 0),
            catchupTime: Number((status as any).catchupTime ?? (status as any)["catchup-time"] ?? 0),
        },
    };
}

/**
 * Get wallet balance: ALGO + all ASA balances (Req 5)
 */
export async function getBalance(
    address: string,
    network: "testnet" | "mainnet"
): Promise<WalletBalance> {
    const indexer = createIndexerClient(network);
    const ep = getNetworkEndpoints(network);

    let accountInfo;
    try {
        accountInfo = await indexer.lookupAccountByID(address).do();
    } catch (err: any) {
        if (err.message?.includes("404") || err.status === 404) {
            return {
                address,
                network,
                algo: { amount: 0, displayAmount: "0.000000" },
                assets: [],
                totalUsdcBalance: "0.00",
            };
        }
        throw err;
    }
    const account = accountInfo.account;

    const algoMicro = Number(account.amount ?? 0);
    const algoDisplay = (algoMicro / 1_000_000).toFixed(6);

    const assets: AssetBalance[] = [];
    let totalUsdcBalance = "0.00";

    const assetHoldings = account.assets ?? [];
    for (const holding of assetHoldings) {
        const assetId = Number((holding as any).assetId ?? (holding as any)["asset-id"] ?? 0);
        const rawAmount = Number(holding.amount ?? 0);

        try {
            const assetInfo = await indexer.lookupAssetByID(assetId).do();
            const params = assetInfo.asset.params;
            const decimals = params.decimals ?? 0;
            const unitName = String((params as any).unitName ?? (params as any)["unit-name"] ?? "");
            const name = String(params.name ?? `ASA-${assetId}`);
            const displayAmount = (rawAmount / Math.pow(10, decimals)).toFixed(decimals);

            assets.push({
                assetId,
                name,
                unitName,
                amount: rawAmount,
                decimals,
                displayAmount,
            });

            if (assetId === ep.usdcAssetId) {
                totalUsdcBalance = displayAmount;
            }
        } catch {
            assets.push({
                assetId,
                name: `ASA-${assetId}`,
                unitName: "",
                amount: rawAmount,
                decimals: 0,
                displayAmount: String(rawAmount),
            });
        }
    }

    return {
        address,
        network,
        algo: { amount: algoMicro, displayAmount: algoDisplay },
        assets,
        totalUsdcBalance,
    };
}

/**
 * Get transaction history from Indexer (Req 20)
 */
export async function getHistory(
    address: string,
    network: "testnet" | "mainnet",
    options: {
        limit?: number;
        type?: "send" | "receive" | "trade" | undefined;
    } = {}
): Promise<TransactionRecord[]> {
    const indexer = createIndexerClient(network);
    const limit = options.limit ?? 10;

    const query = indexer.lookupAccountTransactions(address).limit(limit);
    let result;
    try {
        result = await query.do();
    } catch (err: any) {
        if (err.message?.includes("404") || err.status === 404) {
            return []; // Unfunded account has no history
        }
        throw err;
    }
    const transactions: TransactionRecord[] = [];

    for (const tx of result.transactions ?? []) {
        const txType = String((tx as any).txType ?? (tx as any)["tx-type"] ?? "unknown");

        let receiver = "";
        let amount = 0;
        let assetId: number | null = null;

        if (txType === "pay") {
            const payTx = (tx as any).paymentTransaction ?? (tx as any)["payment-transaction"];
            receiver = payTx?.receiver ?? "";
            amount = Number(payTx?.amount ?? 0);
        } else if (txType === "axfer") {
            const axferTx = (tx as any).assetTransferTransaction ?? (tx as any)["asset-transfer-transaction"];
            receiver = axferTx?.receiver ?? "";
            amount = Number(axferTx?.amount ?? 0);
            assetId = Number(axferTx?.assetId ?? axferTx?.["asset-id"] ?? 0);
        }

        const direction = tx.sender === address ? "send" : "receive";
        if (options.type && options.type !== "trade" && options.type !== direction) {
            continue;
        }

        let note = "";
        if (tx.note) {
            try {
                note = atob(String(tx.note));
            } catch {
                note = "";
            }
        }

        const roundTime = Number((tx as any).roundTime ?? (tx as any)["round-time"] ?? 0);
        const confirmedRound = Number((tx as any).confirmedRound ?? (tx as any)["confirmed-round"] ?? 0);

        transactions.push({
            id: tx.id ?? "",
            type: direction,
            sender: tx.sender ?? "",
            receiver,
            amount,
            assetId,
            fee: Number(tx.fee ?? 0),
            roundTime,
            confirmedRound,
            note,
        });
    }

    return transactions;
}

/**
 * Get suggested transaction parameters (Req 27)
 */
export async function getSuggestedParams(network: "testnet" | "mainnet"): Promise<any> {
    const algod = createAlgodClient(network);
    return await algod.getTransactionParams().do();
}

/**
 * Wait for a transaction to confirm (Req 27)
 */
export async function waitForConfirmation(
    txId: string,
    network: "testnet" | "mainnet",
    maxWaitRounds = 10
): Promise<Record<string, unknown>> {
    const algod = createAlgodClient(network);
    return await algosdk.waitForConfirmation(algod, txId, maxWaitRounds) as any;
}
