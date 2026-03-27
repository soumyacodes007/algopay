/**
 * Algopay Auth Server
 *
 * Express backend handling email OTP authentication.
 * Reqs: 2 (login), 3 (verify), 21 (session), 44 (security)
 *
 * Storage: Redis (if REDIS_URL set) or in-memory Map (dev fallback)
 * Email:   SendGrid (if SENDGRID_API_KEY set) or console (dev)
 */
import "dotenv/config";
interface KVStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    type: "redis" | "memory";
}
export declare function createAuthServer(storeOverride?: KVStore): import("express-serve-static-core").Express;
export {};
//# sourceMappingURL=server.d.ts.map