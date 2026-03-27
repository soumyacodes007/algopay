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
import { logger } from "../utils/production.js";
// --- Circuit Breaker ---
class CircuitBreaker {
    failureThreshold;
    recoveryTimeMs;
    failures = 0;
    lastFailureTime = 0;
    state = 'CLOSED';
    constructor(failureThreshold = 5, recoveryTimeMs = 60000 // 1 minute
    ) {
        this.failureThreshold = failureThreshold;
        this.recoveryTimeMs = recoveryTimeMs;
    }
    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.recoveryTimeMs) {
                this.state = 'HALF_OPEN';
                logger.info('Circuit breaker transitioning to HALF_OPEN');
            }
            else {
                throw new Error('Circuit breaker is OPEN - Intermezzo unavailable');
            }
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    onSuccess() {
        this.failures = 0;
        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
            logger.info('Circuit breaker reset to CLOSED');
        }
    }
    onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            logger.error(`Circuit breaker opened after ${this.failures} failures`);
        }
    }
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
        };
    }
}
// --- Client ---
export class IntermezzoClient {
    url;
    token;
    mockMode;
    circuitBreaker;
    constructor(config) {
        this.url =
            config?.url ?? process.env.INTERMEZZO_URL ?? "http://localhost:3000";
        this.token =
            config?.token ?? process.env.INTERMEZZO_TOKEN ?? "";
        this.mockMode = !config?.url && !process.env.INTERMEZZO_URL;
        this.circuitBreaker = new CircuitBreaker();
        if (this.mockMode) {
            logger.info("Intermezzo running in MOCK mode — no real signing");
        }
        else {
            logger.info(`Intermezzo connecting to ${this.url}`);
        }
    }
    /**
     * Check if Intermezzo/Pawn is reachable.
     * Pawn has no /health endpoint — we try GET /v1/wallet/manager as a proxy.
     */
    async healthCheck() {
        if (this.mockMode)
            return true;
        return this.circuitBreaker.execute(async () => {
            const response = await fetch(`${this.url}/v1/wallet/manager`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${this.token}`,
                },
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                throw new Error(`Intermezzo health check failed: ${response.status}`);
            }
            return true;
        });
    }
    /**
     * Create a new wallet/account via Pawn.
     * Endpoint: POST /v1/wallet/user
     * Body: { user_id: string }
     * Returns: { user_id, public_address, algoBalance }
     *
     * The private key is created inside Vault — NEVER exported.
     */
    async createAccount(sessionId) {
        if (this.mockMode) {
            // Generate a real Algorand account for testing
            const account = algosdk.generateAccount();
            return { address: account.addr.toString() };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/user`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ user_id: sessionId }),
            });
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(`Pawn createAccount failed (${res.status}): ${errorBody}`);
            }
            const data = (await res.json());
            return { address: data.public_address };
        });
    }
    /**
     * Get user details by user_id.
     * Endpoint: GET /v1/wallet/users/:user_id
     */
    async getUser(userId) {
        if (this.mockMode) {
            const account = algosdk.generateAccount();
            return {
                user_id: userId,
                public_address: account.addr.toString(),
                algoBalance: "0",
            };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/users/${userId}`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });
            if (!res.ok) {
                throw new Error(`Pawn getUser failed: ${res.status}`);
            }
            return (await res.json());
        });
    }
    /**
     * Get manager wallet details (public_address, assets, algoBalance).
     * Endpoint: GET /v1/wallet/manager
     */
    async getManager() {
        if (this.mockMode) {
            return { public_address: "MOCK_MANAGER", algoBalance: "0", assets: [] };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/manager`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });
            if (!res.ok) {
                throw new Error(`Pawn getManager failed: ${res.status}`);
            }
            return (await res.json());
        });
    }
    /**
     * Transfer ALGO via Pawn.
     * Endpoint: POST /v1/wallet/transactions/transfer-algo
     * Body: { toAddress, amount, fromUserId, note?, lease? }
     * Pawn builds, signs, and broadcasts the transaction internally.
     */
    async transferAlgo(opts) {
        if (this.mockMode) {
            console.log(`[Intermezzo Mock] Would transfer ${opts.amount} ALGO to ${opts.toAddress}`);
            return { transaction_id: "MOCK_TX_" + Date.now() };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/transactions/transfer-algo`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({
                    toAddress: opts.toAddress,
                    amount: opts.amount,
                    fromUserId: opts.fromUserId,
                    ...(opts.note ? { note: opts.note } : {}),
                }),
            });
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(`Pawn transferAlgo failed (${res.status}): ${errorBody}`);
            }
            return (await res.json());
        });
    }
    /**
     * Transfer an ASA via Pawn.
     * Endpoint: POST /v1/wallet/transactions/transfer-asset
     * Body: { assetId, userId, amount, note?, lease? }
     */
    async transferAsset(opts) {
        if (this.mockMode) {
            console.log(`[Intermezzo Mock] Would transfer ${opts.amount} of ASA ${opts.assetId}`);
            return { transaction_id: "MOCK_TX_" + Date.now() };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/transactions/transfer-asset`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({
                    assetId: opts.assetId,
                    userId: opts.userId,
                    amount: opts.amount,
                    ...(opts.note ? { note: opts.note } : {}),
                }),
            });
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(`Pawn transferAsset failed (${res.status}): ${errorBody}`);
            }
            return (await res.json());
        });
    }
    /**
     * Execute a group (atomic) transaction via Pawn.
     * Endpoint: POST /v1/wallet/transactions/group-transaction
     * Body: { transactions: [{ type, payload }, ...] }
     *   type: "payment" | "appCall" | "assetTransfer" etc.
     */
    async groupTransaction(transactions) {
        if (this.mockMode) {
            console.log(`[Intermezzo Mock] Would execute group of ${transactions.length} transactions`);
            return { group_id: "MOCK_GROUP_" + Date.now() };
        }
        return this.circuitBreaker.execute(async () => {
            const res = await fetch(`${this.url}/v1/wallet/transactions/group-transaction`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ transactions }),
            });
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(`Pawn groupTransaction failed (${res.status}): ${errorBody}`);
            }
            return (await res.json());
        });
    }
    /**
     * Legacy compatibility: Sign transactions via Intermezzo (Req 17).
     * NOTE: The real Pawn API does NOT expose raw signing — it builds+signs+broadcasts
     * internally via transfer-algo, transfer-asset, group-transaction endpoints.
     * This method is kept for mock mode and backward compat with existing send pipeline.
     */
    async signTransactions(unsignedTxns, indices, sessionToken) {
        if (this.mockMode) {
            console.log(`[Intermezzo Mock] Would sign ${indices.length} transaction(s)`);
            return {
                signedTxns: unsignedTxns.map((tx) => algosdk.encodeUnsignedTransaction(tx)),
                txIds: unsignedTxns.map((tx) => tx.txID()),
            };
        }
        // In production, callers should use transferAlgo / transferAsset / groupTransaction
        // instead of raw signing. Pawn handles the full tx lifecycle.
        throw new Error("Raw signTransactions is not supported by Pawn API. " +
            "Use transferAlgo(), transferAsset(), or groupTransaction() instead.");
    }
    /** Returns true if running without a real Pawn backend */
    isMockMode() {
        return this.mockMode;
    }
}
// --- Singleton ---
let clientInstance = null;
export function getIntermezzoClient() {
    if (!clientInstance) {
        clientInstance = new IntermezzoClient();
    }
    return clientInstance;
}
//# sourceMappingURL=intermezzo.js.map