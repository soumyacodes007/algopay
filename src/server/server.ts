/**
 * Algopay Auth Server
 *
 * Express backend handling email OTP authentication.
 * Reqs: 2 (login), 3 (verify), 21 (session), 44 (security)
 *
 * Storage: Redis (if REDIS_URL set) or in-memory Map (dev fallback)
 * Email:   SendGrid (if SENDGRID_API_KEY set) or console (dev)
 */

import express from "express";
import { randomInt, randomUUID } from "crypto";
import jwt from "jsonwebtoken";

// --- Types ---

interface OtpRecord {
    email: string;
    otp: string;
    attempts: number;
    createdAt: number;
}

interface RateLimitRecord {
    count: number;
    resetAt: number;
}

// --- Config ---

const JWT_SECRET = process.env.JWT_SECRET ?? "algopay-dev-secret-change-me";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes (Req 2.5)
const OTP_TTL_SEC = 600;
const MAX_OTP_ATTEMPTS = 3; // (Req 3.7)
const RATE_LIMIT_MAX = 5; // 5 per hour (Req 44)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SESSION_VALIDITY_DAYS = 30; // (Req 21.7)

// --- Storage abstraction (Redis or Map fallback) ---

interface KVStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    type: "redis" | "memory";
}

async function createRedisStore(redisUrl: string): Promise<KVStore | null> {
    try {
        const Redis = (await import("ioredis")).default;
        const redis = new (Redis as any)(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
            lazyConnect: true,
        });
        await redis.connect();
        await redis.ping();
        console.log("✅ Redis connected at", redisUrl);
        return {
            type: "redis",
            async get(key: string) { return redis.get(key); },
            async set(key: string, value: string, ttlSeconds?: number) {
                if (ttlSeconds) await redis.set(key, value, "EX", ttlSeconds);
                else await redis.set(key, value);
            },
            async del(key: string) { await redis.del(key); },
        };
    } catch (err: any) {
        console.warn(`⚠️  Redis unavailable (${err.message}). Using in-memory store.`);
        return null;
    }
}

function createMemoryStore(): KVStore {
    const map = new Map<string, { value: string; expiresAt?: number }>();
    console.log("📦 Using in-memory store (data lost on restart)");
    return {
        type: "memory",
        async get(key: string) {
            const entry = map.get(key);
            if (!entry) return null;
            if (entry.expiresAt && Date.now() > entry.expiresAt) {
                map.delete(key);
                return null;
            }
            return entry.value;
        },
        async set(key: string, value: string, ttlSeconds?: number) {
            map.set(key, {
                value,
                expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
            });
        },
        async del(key: string) { map.delete(key); },
    };
}

// --- Invalidated tokens (always in-memory, fine for single-instance) ---
const invalidatedTokens = new Set<string>();

// --- Helpers ---

function generateOtp(): string {
    return String(randomInt(100000, 999999));
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function generateWalletAddress(): string {
    // In production, this is returned by Intermezzo after session creation.
    // For now, generate a mock Algorand-like address for dev/testing.
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let addr = "";
    for (let i = 0; i < 58; i++) {
        addr += chars[randomInt(0, chars.length)];
    }
    return addr;
}

// --- Email delivery ---

async function sendOtpEmail(email: string, otp: string): Promise<void> {
    if (process.env.SENDGRID_API_KEY) {
        try {
            const sgMail = (await import("@sendgrid/mail")).default;
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            await sgMail.send({
                to: email,
                from: process.env.ALGOPAY_FROM_EMAIL ?? "noreply@algopay.dev",
                subject: "Your Algopay Login Code",
                text: `Your one-time code is: ${otp}\n\nExpires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
                html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
                    <h2 style="color:#6366f1;">🔐 Algopay</h2>
                    <p>Your one-time login code:</p>
                    <div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#6366f1;padding:16px;background:#f3f4f6;border-radius:8px;text-align:center;">${otp}</div>
                    <p style="color:#6b7280;font-size:14px;margin-top:16px;">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
                </div>`,
            });
            console.log(`📧 OTP sent to ${email} via SendGrid`);
        } catch (err: any) {
            console.error(`❌ SendGrid failed: ${err.message}. Falling back to console.`);
            console.log(`[DEV] OTP for ${email}: ${otp}`);
        }
    } else {
        // Dev mode: print to console
        console.log(`[DEV] OTP for ${email}: ${otp}`);
    }
}

// --- Express App ---

export function createAuthServer(storeOverride?: KVStore) {
    const app = express();
    app.use(express.json());

    // Store will be initialized async, use memory as default
    let store: KVStore = storeOverride ?? createMemoryStore();

    // Initialize Redis store async (if REDIS_URL is set and no override)
    if (!storeOverride && process.env.REDIS_URL) {
        createRedisStore(process.env.REDIS_URL).then((redisStore) => {
            if (redisStore) store = redisStore;
        });
    }

    // --- Rate limiting helper (uses store) ---
    async function checkRateLimit(email: string): Promise<boolean> {
        const key = `ratelimit:${email}`;
        const raw = await store.get(key);

        if (!raw) {
            await store.set(key, JSON.stringify({ count: 1, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS }), 3600);
            return true;
        }

        const record: RateLimitRecord = JSON.parse(raw);

        if (Date.now() > record.resetAt) {
            await store.set(key, JSON.stringify({ count: 1, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS }), 3600);
            return true;
        }

        if (record.count >= RATE_LIMIT_MAX) {
            return false;
        }

        record.count++;
        await store.set(key, JSON.stringify(record), Math.ceil((record.resetAt - Date.now()) / 1000));
        return true;
    }

    /**
     * POST /auth/login
     * Accepts { email }, sends OTP, returns { flowId }
     * Req 2.1–2.5
     */
    app.post("/auth/login", async (req, res) => {
        const { email: rawEmail } = req.body;

        if (!rawEmail || typeof rawEmail !== "string") {
            res.status(400).json({
                error: "INVALID_INPUT",
                message: "Email is required.",
            });
            return;
        }

        const email = sanitizeEmail(rawEmail);

        // Req 2.4: validate email format before any network call
        if (!isValidEmail(email)) {
            res.status(400).json({
                error: "INVALID_EMAIL",
                message: "Invalid email format. Expected: user@domain.com",
            });
            return;
        }

        // Req 44: rate limiting
        if (!(await checkRateLimit(email))) {
            res.status(429).json({
                error: "RATE_LIMITED",
                message:
                    "Too many login attempts. Try again in 1 hour.",
            });
            return;
        }

        const flowId = randomUUID();
        const otp = generateOtp();

        // Store OTP with TTL (Req 2.5: 10 minutes)
        const otpRecord: OtpRecord = {
            email,
            otp,
            attempts: 0,
            createdAt: Date.now(),
        };
        await store.set(`otp:${flowId}`, JSON.stringify(otpRecord), OTP_TTL_SEC);

        // Send OTP (SendGrid or console)
        await sendOtpEmail(email, otp);

        // Also log flowId for dev convenience
        if (!process.env.SENDGRID_API_KEY) {
            console.log(`[DEV] OTP for ${email}: ${otp} (flowId: ${flowId})`);
        }

        res.json({
            flowId,
            message: `OTP sent to ${email}. Check your email.`,
            expiresIn: "10 minutes",
        });
    });

    /**
     * POST /auth/verify
     * Accepts { flowId, otp }, returns { sessionToken, walletAddress }
     * Req 3.1–3.7
     */
    app.post("/auth/verify", async (req, res) => {
        const { flowId, otp } = req.body;

        if (!flowId || !otp) {
            res.status(400).json({
                error: "INVALID_INPUT",
                message: "flowId and otp are required.",
            });
            return;
        }

        const raw = await store.get(`otp:${flowId}`);

        // Req 3.6: check if expired
        if (!raw) {
            res.status(400).json({
                error: "INVALID_FLOW",
                message:
                    "Flow ID not found or expired. Request a new OTP.",
            });
            return;
        }

        const record: OtpRecord = JSON.parse(raw);

        // Check TTL
        if (Date.now() - record.createdAt > OTP_TTL_MS) {
            await store.del(`otp:${flowId}`);
            res.status(400).json({
                error: "OTP_EXPIRED",
                message: "OTP has expired. Request a new one.",
            });
            return;
        }

        // Req 3.7: max 3 attempts
        if (record.attempts >= MAX_OTP_ATTEMPTS) {
            await store.del(`otp:${flowId}`);
            res.status(400).json({
                error: "MAX_ATTEMPTS",
                message:
                    "Maximum verification attempts exceeded. Request a new OTP.",
            });
            return;
        }

        // Check OTP
        if (record.otp !== String(otp)) {
            record.attempts++;
            await store.set(`otp:${flowId}`, JSON.stringify(record), OTP_TTL_SEC);
            res.status(401).json({
                error: "INVALID_OTP",
                message: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - record.attempts} attempts remaining.`,
            });
            return;
        }

        // OTP matches — success!
        await store.del(`otp:${flowId}`);

        // In production: create Intermezzo session and get wallet address
        // For dev: generate mock wallet address
        const walletAddress = generateWalletAddress();

        // Generate JWT session token (Req 21.7: 30-day validity)
        const sessionToken = jwt.sign(
            {
                email: record.email,
                walletAddress,
                iat: Math.floor(Date.now() / 1000),
            },
            JWT_SECRET,
            { expiresIn: `${SESSION_VALIDITY_DAYS}d` }
        );

        res.json({
            sessionToken,
            walletAddress,
            email: record.email,
            expiresIn: `${SESSION_VALIDITY_DAYS} days`,
        });
    });

    /**
     * POST /auth/logout
     * Accepts { sessionToken }, invalidates the session
     * Req 21.6
     */
    app.post("/auth/logout", (req, res) => {
        const authHeader = req.headers.authorization;
        const token =
            authHeader?.startsWith("Bearer ")
                ? authHeader.slice(7)
                : req.body.sessionToken;

        if (!token) {
            res.status(400).json({
                error: "INVALID_INPUT",
                message: "Session token is required.",
            });
            return;
        }

        invalidatedTokens.add(token);

        res.json({
            message: "Logged out successfully.",
        });
    });

    /**
     * GET /auth/session
     * Validates session token and returns user info
     */
    app.get("/auth/session", (req, res) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!token) {
            res.status(401).json({
                error: "NO_TOKEN",
                message: "Authorization header required.",
            });
            return;
        }

        if (invalidatedTokens.has(token)) {
            res.status(401).json({
                error: "TOKEN_INVALIDATED",
                message: "Session has been logged out.",
            });
            return;
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as {
                email: string;
                walletAddress: string;
            };

            res.json({
                email: decoded.email,
                walletAddress: decoded.walletAddress,
                authenticated: true,
            });
        } catch {
            res.status(401).json({
                error: "INVALID_TOKEN",
                message: "Session token is invalid or expired.",
            });
        }
    });

    /**
     * GET /health
     * Health check endpoint (Req 41.4)
     */
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            service: "algopay-backend",
            version: "0.1.0",
            storage: store.type,
            timestamp: new Date().toISOString(),
        });
    });

    return app;
}

// --- Start server if run directly ---

const PORT = parseInt(process.env.PORT ?? "3001", 10);

if (
    process.argv[1] &&
    (process.argv[1].endsWith("server.ts") ||
        process.argv[1].endsWith("server.js"))
) {
    const app = createAuthServer();
    app.listen(PORT, () => {
        console.log(`🔐 Algopay Auth Server running on http://localhost:${PORT}`);
        console.log(`   POST /auth/login    — send OTP`);
        console.log(`   POST /auth/verify   — verify OTP`);
        console.log(`   POST /auth/logout   — end session`);
        console.log(`   GET  /auth/session  — check session`);
        console.log(`   GET  /health        — health check`);
    });
}
