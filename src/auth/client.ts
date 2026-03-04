/**
 * Auth Client — CLI-side auth functions that call the backend
 * Reqs: 2, 3, 21
 */

import { getConfig } from "../config.js";

export interface LoginResponse {
    flowId: string;
    message: string;
    expiresIn: string;
}

export interface VerifyResponse {
    sessionToken: string;
    walletAddress: string;
    email: string;
    expiresIn: string;
}

export interface SessionResponse {
    email: string;
    walletAddress: string;
    authenticated: boolean;
}

function getBackendUrl(): string {
    return process.env.ALGOPAY_BACKEND_URL ?? "http://localhost:3001";
}

/**
 * Validate email format locally before making network call (Req 2.4)
 */
export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /auth/login — send OTP to email
 */
export async function login(email: string): Promise<LoginResponse> {
    // Req 2.4: validate locally first
    if (!isValidEmail(email)) {
        throw new Error(
            "Invalid email format. Expected: user@domain.com"
        );
    }

    const res = await fetch(`${getBackendUrl()}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
    });

    const data = (await res.json()) as { message?: string };

    if (!res.ok) {
        throw new Error(data.message ?? `Login failed (${res.status})`);
    }

    return data as LoginResponse;
}

/**
 * POST /auth/verify — verify OTP and get session token
 */
export async function verify(
    flowId: string,
    otp: string
): Promise<VerifyResponse> {
    const res = await fetch(`${getBackendUrl()}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, otp }),
    });

    const data = (await res.json()) as { message?: string };

    if (!res.ok) {
        throw new Error(data.message ?? `Verification failed (${res.status})`);
    }

    const result = data as VerifyResponse;

    // Req 21.1–21.3: persist session locally
    const config = getConfig();
    config.set("sessionToken", result.sessionToken);
    config.set("walletAddress", result.walletAddress);

    return result;
}

/**
 * POST /auth/logout — invalidate session
 */
export async function logout(): Promise<void> {
    const config = getConfig();
    const token = config.get("sessionToken");

    if (token) {
        try {
            await fetch(`${getBackendUrl()}/auth/logout`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
        } catch {
            // Ignore network errors during logout — still clear local
        }
    }

    // Req 21.6: always clear local session regardless of server response
    config.delete("sessionToken" as any);
    config.delete("walletAddress" as any);
}

/**
 * GET /auth/session — check if current session is valid
 */
export async function checkSession(): Promise<SessionResponse | null> {
    const config = getConfig();
    const token = config.get("sessionToken");

    if (!token) {
        return null;
    }

    try {
        const res = await fetch(`${getBackendUrl()}/auth/session`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            // Token invalid/expired — clear it
            config.delete("sessionToken" as any);
            config.delete("walletAddress" as any);
            return null;
        }

        return (await res.json()) as SessionResponse;
    } catch {
        return null;
    }
}

/**
 * Get stored session token (for use by other commands)
 */
export function getSessionToken(): string | null {
    return getConfig().get("sessionToken");
}

/**
 * Get stored wallet address
 */
export function getWalletAddress(): string | null {
    return getConfig().get("walletAddress");
}
