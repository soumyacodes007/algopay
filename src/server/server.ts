/**
 * Algopay Auth Server
 *
 * Express backend handling email OTP authentication.
 * Reqs: 2 (login), 3 (verify), 21 (session), 44 (security)
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

// --- In-memory stores (swap for Redis in production) ---

const otpStore = new Map<string, OtpRecord>();
const rateLimitStore = new Map<string, RateLimitRecord>();
const invalidatedTokens = new Set<string>();

// --- Config ---

const JWT_SECRET = process.env.JWT_SECRET ?? "algopay-dev-secret-change-me";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes (Req 2.5)
const MAX_OTP_ATTEMPTS = 3; // (Req 3.7)
const RATE_LIMIT_MAX = 5; // 5 per hour (Req 44)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SESSION_VALIDITY_DAYS = 30; // (Req 21.7)

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

function checkRateLimit(email: string): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(email);

    if (!record || now > record.resetAt) {
        rateLimitStore.set(email, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS,
        });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }

    record.count++;
    return true;
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

// --- Express App ---

export function createAuthServer() {
    const app = express();
    app.use(express.json());

    /**
     * POST /auth/login
     * Accepts { email }, sends OTP, returns { flowId }
     * Req 2.1–2.5
     */
    app.post("/auth/login", (req, res) => {
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
        if (!checkRateLimit(email)) {
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
        otpStore.set(flowId, {
            email,
            otp,
            attempts: 0,
            createdAt: Date.now(),
        });

        // Clean up expired OTPs after TTL
        setTimeout(() => {
            otpStore.delete(flowId);
        }, OTP_TTL_MS);

        // In production: send OTP via SendGrid/Resend
        // For dev: log to console
        if (process.env.SENDGRID_API_KEY) {
            // TODO: Implement SendGrid delivery
            console.log(`[SendGrid] OTP sent to ${email}`);
        } else {
            console.log(
                `[DEV] OTP for ${email}: ${otp} (flowId: ${flowId})`
            );
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
    app.post("/auth/verify", (req, res) => {
        const { flowId, otp } = req.body;

        if (!flowId || !otp) {
            res.status(400).json({
                error: "INVALID_INPUT",
                message: "flowId and otp are required.",
            });
            return;
        }

        const record = otpStore.get(flowId);

        // Req 3.6: check if expired
        if (!record) {
            res.status(400).json({
                error: "INVALID_FLOW",
                message:
                    "Flow ID not found or expired. Request a new OTP.",
            });
            return;
        }

        // Check TTL
        if (Date.now() - record.createdAt > OTP_TTL_MS) {
            otpStore.delete(flowId);
            res.status(400).json({
                error: "OTP_EXPIRED",
                message: "OTP has expired. Request a new one.",
            });
            return;
        }

        // Req 3.7: max 3 attempts
        if (record.attempts >= MAX_OTP_ATTEMPTS) {
            otpStore.delete(flowId);
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
            res.status(401).json({
                error: "INVALID_OTP",
                message: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - record.attempts} attempts remaining.`,
            });
            return;
        }

        // OTP matches — success!
        otpStore.delete(flowId);

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
