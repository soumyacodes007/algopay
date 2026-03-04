/**
 * Intermezzo Client — Wrapper for Algorand Foundation's custodial signing API
 * Req 17: All signing must go through Intermezzo
 *
 * In production, Intermezzo runs on HashiCorp Vault and exposes REST endpoints.
 * In dev mode, we use a mock that simulates the signing flow.
 */

import algosdk from "algosdk";

// --- Types ---

export interface IntermezzoConfig {
    url: string;
    token: string;
}

export interface SignResult {
    signedTxns: Uint8Array[];
    txIds: string[];
}

// --- Client ---

export class IntermezzoClient {
    private url: string;
    private token: string;
    private mockMode: boolean;

    constructor(config?: IntermezzoConfig) {
        this.url =
            config?.url ?? process.env.INTERMEZZO_URL ?? "http://localhost:8200";
        this.token =
            config?.token ?? process.env.INTERMEZZO_TOKEN ?? "";
        this.mockMode = !config?.url && !process.env.INTERMEZZO_URL;

        if (this.mockMode) {
            console.log(
                "[Intermezzo] Running in MOCK mode — no real signing"
            );
        }
    }

    /**
     * Check if Intermezzo is reachable
     */
    async healthCheck(): Promise<boolean> {
        if (this.mockMode) return true;

        try {
            const res = await fetch(`${this.url}/v1/health`, {
                headers: { Authorization: `Bearer ${this.token}` },
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Create a new wallet/account via Intermezzo
     * Returns the public address (private key stays in Vault)
     */
    async createAccount(
        sessionId: string
    ): Promise<{ address: string }> {
        if (this.mockMode) {
            // Generate a real Algorand account for testing
            const account = algosdk.generateAccount();
            return { address: account.addr.toString() };
        }

        const res = await fetch(`${this.url}/v1/accounts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({ sessionId }),
        });

        if (!res.ok) {
            throw new Error(
                `Intermezzo createAccount failed: ${res.status}`
            );
        }

        return (await res.json()) as { address: string };
    }

    /**
     * Sign transactions via Intermezzo (Req 17)
     * Private keys NEVER leave Intermezzo/Vault.
     *
     * @param unsignedTxns - The unsigned transactions to sign
     * @param indices - Which transaction indices to sign (user txns only)
     * @param sessionToken - JWT session token for auth
     */
    async signTransactions(
        unsignedTxns: algosdk.Transaction[],
        indices: number[],
        sessionToken: string
    ): Promise<SignResult> {
        if (this.mockMode) {
            // In mock mode, we can't actually sign since we don't have keys.
            // Return empty signed txns — the caller should handle this gracefully.
            console.log(
                `[Intermezzo Mock] Would sign ${indices.length} transaction(s)`
            );

            return {
                signedTxns: unsignedTxns.map((tx) =>
                    algosdk.encodeUnsignedTransaction(tx)
                ),
                txIds: unsignedTxns.map((tx) => tx.txID()),
            };
        }

        // Encode transactions for transport
        const encodedTxns = unsignedTxns.map((tx) =>
            Buffer.from(algosdk.encodeUnsignedTransaction(tx)).toString(
                "base64"
            )
        );

        const res = await fetch(`${this.url}/v1/transactions/sign`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
                "X-Session-Token": sessionToken,
            },
            body: JSON.stringify({
                transactions: encodedTxns,
                indicesToSign: indices,
            }),
        });

        if (!res.ok) {
            const error = (await res.json()) as { message?: string };
            throw new Error(
                `Intermezzo signing failed: ${error.message ?? res.status}`
            );
        }

        const data = (await res.json()) as {
            signedTransactions: string[];
            transactionIds: string[];
        };

        return {
            signedTxns: data.signedTransactions.map(
                (b64) => new Uint8Array(Buffer.from(b64, "base64"))
            ),
            txIds: data.transactionIds,
        };
    }
}

// --- Singleton ---

let clientInstance: IntermezzoClient | null = null;

export function getIntermezzoClient(): IntermezzoClient {
    if (!clientInstance) {
        clientInstance = new IntermezzoClient();
    }
    return clientInstance;
}
