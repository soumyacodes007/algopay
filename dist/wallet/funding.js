/**
 * Wallet Funding Module — Onramp & deposit watching
 * Req 12: Fund wallet with USDC/ALGO
 *
 * AWAL equivalent: Coinbase Pay onramp (Card, Apple Pay, Bank)
 * Algopay equivalents:
 *   1. Pera Fund (Meld fiat + Exodus cross-chain swaps)
 *   2. Direct USDC/ALGO deposit to wallet address
 *   3. Algorand Testnet Dispenser (for development)
 *
 * This module generates funding links and watches for deposits.
 */
import { createIndexerClient } from "./queries.js";
// --- Funding Links ---
/**
 * Generate all available funding methods for a wallet address (Req 12)
 */
export function getFundingMethods(walletAddress, network) {
    const methods = [];
    if (network === "mainnet") {
        // Pera Fund — fiat onramp via Meld
        methods.push({
            name: "Pera Fund (Fiat)",
            type: "fiat",
            url: `https://app.perawallet.app/deeplink?type=fund&address=${walletAddress}`,
            description: "Buy ALGO/USDC with credit card, Apple Pay, or bank transfer via Pera Wallet",
            processingTime: "Instant (card) / 1-3 days (bank)",
        });
        // Direct USDC deposit
        methods.push({
            name: "Direct USDC Deposit",
            type: "crypto",
            url: "",
            description: `Send USDC (ASA 31566704) to: ${walletAddress}`,
            processingTime: "< 3 seconds",
        });
        // Direct ALGO deposit
        methods.push({
            name: "Direct ALGO Deposit",
            type: "crypto",
            url: "",
            description: `Send ALGO to: ${walletAddress}`,
            processingTime: "< 3 seconds",
        });
        // Exodus cross-chain swap via Pera Fund
        methods.push({
            name: "Pera Fund (Cross-chain)",
            type: "crypto",
            url: `https://app.perawallet.app/deeplink?type=fund&address=${walletAddress}`,
            description: "Swap BTC, ETH, or other crypto to ALGO via Exodus integration in Pera",
            processingTime: "5-30 minutes",
        });
    }
    else {
        // Testnet dispenser
        methods.push({
            name: "Algorand Testnet Dispenser",
            type: "testnet",
            url: `https://bank.testnet.algorand.network/?account=${walletAddress}`,
            description: "Get free testnet ALGO from the official dispenser",
            processingTime: "< 10 seconds",
        });
        // AlgoKit dispenser (CLI)
        methods.push({
            name: "AlgoKit Testnet Dispenser (CLI)",
            type: "testnet",
            url: "",
            description: `Run: algokit dispenser fund --receiver ${walletAddress} --amount 10`,
            processingTime: "Instant (requires algokit dispenser login first)",
        });
        // Direct testnet deposit
        methods.push({
            name: "Direct Testnet Deposit",
            type: "crypto",
            url: "",
            description: `Send testnet ALGO to: ${walletAddress}`,
            processingTime: "< 3 seconds",
        });
    }
    return {
        walletAddress,
        network,
        methods,
    };
}
// --- Testnet Dispenser ---
/**
 * Request free testnet ALGO from the Algorand dispenser.
 * Returns the dispenser URL for the user to visit.
 */
export function getTestnetDispenserUrl(walletAddress) {
    return `https://bank.testnet.algorand.network/?account=${walletAddress}`;
}
// --- Deposit Watcher ---
/**
 * Watch for incoming deposits to a wallet address (Req 12).
 * Polls the Indexer for new transactions.
 *
 * @param walletAddress The address to monitor
 * @param network testnet or mainnet
 * @param afterRound Only show txns after this round (0 = all recent)
 * @param limit Max transactions to return
 */
export async function checkDeposits(walletAddress, network, afterRound = 0, limit = 5) {
    const indexer = createIndexerClient(network);
    try {
        let query = indexer
            .lookupAccountTransactions(walletAddress)
            .limit(limit);
        if (afterRound > 0) {
            query = query.minRound(afterRound);
        }
        let txns = [];
        try {
            const result = await query.do();
            txns = result.transactions ?? [];
        }
        catch (err) {
            if (err.message?.includes("404") || err.status === 404) {
                return []; // Unfunded account
            }
            throw err;
        }
        const deposits = [];
        for (const tx of txns) {
            // Only incoming transactions (where this address is the receiver)
            const isPayment = tx["tx-type"] === "pay";
            const isAssetTransfer = tx["tx-type"] === "axfer";
            if (isPayment) {
                const receiver = tx["payment-transaction"]?.receiver ?? "";
                if (receiver === walletAddress) {
                    const microAmount = Number(tx["payment-transaction"]?.amount ?? 0);
                    deposits.push({
                        txId: tx.id,
                        amount: microAmount / 1_000_000,
                        asset: "ALGO",
                        sender: tx.sender,
                        confirmedRound: tx["confirmed-round"],
                        timestamp: tx["round-time"] ?? 0,
                    });
                }
            }
            if (isAssetTransfer) {
                const receiver = tx["asset-transfer-transaction"]?.receiver ?? "";
                if (receiver === walletAddress) {
                    const amount = Number(tx["asset-transfer-transaction"]?.amount ?? 0);
                    const assetId = tx["asset-transfer-transaction"]?.["asset-id"] ?? 0;
                    const isUsdc = assetId === 31566704 || assetId === 10458941;
                    deposits.push({
                        txId: tx.id,
                        amount: isUsdc ? amount / 1_000_000 : amount,
                        asset: isUsdc ? "USDC" : `ASA-${assetId}`,
                        sender: tx.sender,
                        confirmedRound: tx["confirmed-round"],
                        timestamp: tx["round-time"] ?? 0,
                    });
                }
            }
        }
        return deposits;
    }
    catch (err) {
        throw new Error(`Failed to check deposits: ${err.message}`);
    }
}
//# sourceMappingURL=funding.js.map