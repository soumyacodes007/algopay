/**
 * Atomic Group Builder & Fee Pooling
 * Reqs: 16 (atomic groups), 32 (atomic composer), 33 (fee pooling)
 *
 * Fee pooling: the backend wallet pays ALL transaction fees for the user.
 * Algorand supports this natively via atomic groups — no smart contract needed.
 */

import algosdk from "algosdk";
import { createAlgodClient } from "./queries.js";

// --- Types ---

export interface FeePooledGroup {
    unsignedTxns: algosdk.Transaction[];
    feePaymentIndex: number;
    userTxIndices: number[];
    totalFee: number;
}

// --- Fee Pooling ---

/**
 * Build a fee-pooled atomic group (Req 33)
 */
export async function buildFeePooledGroup(
    userTxns: algosdk.Transaction[],
    backendAddress: string,
    network: "testnet" | "mainnet"
): Promise<FeePooledGroup> {
    const algod = createAlgodClient(network);
    const params = await algod.getTransactionParams().do();

    const minFee = Number(params.minFee ?? 1000);
    const totalTxns = userTxns.length + 1;
    const totalFee = minFee * totalTxns;

    // Set all user transaction fees to 0 (Req 33.3)
    for (const tx of userTxns) {
        (tx as any).fee = BigInt(0);
    }

    // Create the fee payment tx from backend wallet (Req 33.4)
    const feePaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: backendAddress,
        receiver: backendAddress,
        amount: 0,
        suggestedParams: {
            ...params,
            fee: BigInt(totalFee),
            flatFee: true,
        },
    });

    const allTxns = [feePaymentTxn, ...userTxns];

    // Assign group ID (Req 16)
    const groupedTxns = algosdk.assignGroupID(allTxns);

    return {
        unsignedTxns: groupedTxns,
        feePaymentIndex: 0,
        userTxIndices: userTxns.map((_, i) => i + 1),
        totalFee,
    };
}

/**
 * Build a simple USDC transfer with fee pooling (Req 8 + 33)
 */
export async function buildUsdcTransfer(
    senderAddress: string,
    recipientAddress: string,
    usdcAmount: number,
    usdcAssetId: number,
    backendAddress: string,
    network: "testnet" | "mainnet"
): Promise<FeePooledGroup> {
    const algod = createAlgodClient(network);
    const params = await algod.getTransactionParams().do();

    const microAmount = Math.round(usdcAmount * 1_000_000);

    const usdcTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: senderAddress,
        receiver: recipientAddress,
        amount: microAmount,
        assetIndex: usdcAssetId,
        suggestedParams: params,
    });

    return buildFeePooledGroup([usdcTxn], backendAddress, network);
}

/**
 * Build an ALGO transfer with fee pooling
 */
export async function buildAlgoTransfer(
    senderAddress: string,
    recipientAddress: string,
    algoAmount: number,
    backendAddress: string,
    network: "testnet" | "mainnet"
): Promise<FeePooledGroup> {
    const algod = createAlgodClient(network);
    const params = await algod.getTransactionParams().do();

    const microAmount = Math.round(algoAmount * 1_000_000);

    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: senderAddress,
        receiver: recipientAddress,
        amount: microAmount,
        suggestedParams: params,
    });

    return buildFeePooledGroup([payTxn], backendAddress, network);
}
