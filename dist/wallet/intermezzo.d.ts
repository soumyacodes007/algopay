/**
 * Intermezzo Client — Wrapper for Algorand Foundation's Pawn custodial wallet API
 * Req 17: All signing must go through Intermezzo (Pawn + Vault)
 * Req 30: Circuit breaker for health monitoring
 *
 * Pawn API (NestJS) runs on HashiCorp Vault and exposes REST endpoints.
 * In dev mode (no INTERMEZZO_URL), we use a mock that simulates the flow.
 *
 * Real Pawn API routes (from Swagger /docs-json):
 *   POST /v1/auth/sign-in              — exchange vault_token for JWT
 *   POST /v1/wallet/user               — create user wallet { user_id } → { user_id, public_address, algoBalance }
 *   GET  /v1/wallet/users              — list users
 *   GET  /v1/wallet/users/:user_id     — get user detail
 *   GET  /v1/wallet/manager            — get manager info
 *   GET  /v1/wallet/assets/:user_id    — get user asset holdings
 *   POST /v1/wallet/transactions/transfer-algo   — send ALGO { toAddress, amount, fromUserId }
 *   POST /v1/wallet/transactions/transfer-asset  — send ASA  { assetId, userId, amount }
 *   POST /v1/wallet/transactions/group-transaction — atomic group
 *   POST /v1/wallet/transactions/app-call        — smart contract call
 *   POST /v1/wallet/transactions/create-asset    — create ASA
 *   POST /v1/wallet/transactions/clawback-asset  — clawback ASA
 */
import algosdk from "algosdk";
export interface IntermezzoConfig {
    url: string;
    token: string;
}
export interface SignResult {
    signedTxns: Uint8Array[];
    txIds: string[];
}
export interface PawnUserInfo {
    user_id: string;
    public_address: string;
    algoBalance: string;
}
export interface PawnTransferResult {
    transaction_id: string;
}
export interface PawnGroupResult {
    group_id: string;
}
export declare class IntermezzoClient {
    private url;
    private token;
    private mockMode;
    private circuitBreaker;
    constructor(config?: IntermezzoConfig);
    /**
     * Check if Intermezzo/Pawn is reachable.
     * Pawn has no /health endpoint — we try GET /v1/wallet/manager as a proxy.
     */
    healthCheck(): Promise<boolean>;
    /**
     * Create a new wallet/account via Pawn.
     * Endpoint: POST /v1/wallet/user
     * Body: { user_id: string }
     * Returns: { user_id, public_address, algoBalance }
     *
     * The private key is created inside Vault — NEVER exported.
     */
    createAccount(sessionId: string): Promise<{
        address: string;
    }>;
    /**
     * Get user details by user_id.
     * Endpoint: GET /v1/wallet/users/:user_id
     */
    getUser(userId: string): Promise<PawnUserInfo>;
    /**
     * Get manager wallet details (public_address, assets, algoBalance).
     * Endpoint: GET /v1/wallet/manager
     */
    getManager(): Promise<{
        public_address: string;
        algoBalance: string;
        assets: any[];
    }>;
    /**
     * Transfer ALGO via Pawn.
     * Endpoint: POST /v1/wallet/transactions/transfer-algo
     * Body: { toAddress, amount, fromUserId, note?, lease? }
     * Pawn builds, signs, and broadcasts the transaction internally.
     */
    transferAlgo(opts: {
        toAddress: string;
        amount: number;
        fromUserId: string;
        note?: string;
    }): Promise<PawnTransferResult>;
    /**
     * Transfer an ASA via Pawn.
     * Endpoint: POST /v1/wallet/transactions/transfer-asset
     * Body: { assetId, userId, amount, note?, lease? }
     */
    transferAsset(opts: {
        assetId: number;
        userId: string;
        amount: number;
        note?: string;
    }): Promise<PawnTransferResult>;
    /**
     * Execute a group (atomic) transaction via Pawn.
     * Endpoint: POST /v1/wallet/transactions/group-transaction
     * Body: { transactions: [{ type, payload }, ...] }
     *   type: "payment" | "appCall" | "assetTransfer" etc.
     */
    groupTransaction(transactions: Array<{
        type: string;
        payload: Record<string, any>;
    }>): Promise<PawnGroupResult>;
    /**
     * Legacy compatibility: Sign transactions via Intermezzo (Req 17).
     * NOTE: The real Pawn API does NOT expose raw signing — it builds+signs+broadcasts
     * internally via transfer-algo, transfer-asset, group-transaction endpoints.
     * This method is kept for mock mode and backward compat with existing send pipeline.
     */
    signTransactions(unsignedTxns: algosdk.Transaction[], indices: number[], sessionToken: string): Promise<SignResult>;
    /** Returns true if running without a real Pawn backend */
    isMockMode(): boolean;
}
export declare function getIntermezzoClient(): IntermezzoClient;
//# sourceMappingURL=intermezzo.d.ts.map