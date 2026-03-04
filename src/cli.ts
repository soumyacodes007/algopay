#!/usr/bin/env node

import { Command } from "commander";
import { getConfig } from "./config.js";

const program = new Command();

program
    .name("algopay")
    .description(
        "Agentic payment wallet for Algorand — Stripe for AI Agents"
    )
    .version("0.1.0")
    .option(
        "--network <network>",
        "Algorand network (testnet or mainnet)",
        undefined
    )
    .option("--json", "Output in JSON format", false)
    .hook("preAction", (thisCommand) => {
        const opts = thisCommand.opts();
        const config = getConfig();

        // Resolve network: CLI flag > config > default (testnet)
        const network =
            opts.network ?? config.get("defaultNetwork") ?? "testnet";

        if (network !== "testnet" && network !== "mainnet") {
            console.error(
                `Error: Invalid network "${network}". Use "testnet" or "mainnet".`
            );
            process.exit(1);
        }

        // Store resolved options on the command for sub-commands to access
        thisCommand.setOptionValue("resolvedNetwork", network);
    });

// --- Auth commands ---
const auth = program.command("auth").description("Authentication commands");

auth
    .command("login <email>")
    .description("Authenticate with email OTP")
    .action(async (email: string) => {
        console.log(`TODO: Send OTP to ${email}`);
    });

auth
    .command("verify <flowId> <otp>")
    .description("Verify OTP code")
    .action(async (flowId: string, otp: string) => {
        console.log(`TODO: Verify OTP ${otp} for flow ${flowId}`);
    });

auth
    .command("logout")
    .description("Clear session token")
    .action(async () => {
        const config = getConfig();
        config.delete("sessionToken" as any);
        console.log("Logged out successfully.");
    });

// --- Wallet commands ---
program
    .command("status")
    .description("Check wallet status")
    .action(async () => {
        console.log("TODO: Query wallet status via MCP + Indexer");
    });

program
    .command("balance")
    .description("Check wallet balance")
    .action(async () => {
        console.log("TODO: Query ALGO + USDC + ASA balances");
    });

program
    .command("address")
    .description("Show wallet address")
    .action(async () => {
        const config = getConfig();
        const address = config.get("walletAddress");
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        if (opts.json) {
            console.log(JSON.stringify({ address }));
        } else {
            console.log(address);
        }
    });

program
    .command("history")
    .description("View transaction history")
    .option("--limit <n>", "Number of transactions", "10")
    .option("--type <type>", "Filter by type (send|receive|trade)")
    .action(async () => {
        console.log("TODO: Query Indexer for tx history");
    });

// --- Transaction commands ---
program
    .command("send <amount> <recipient>")
    .description("Send USDC or other assets")
    .option("--asset <id>", "Asset ID or name", "USDC")
    .option("--dry-run", "Simulate without executing")
    .option("--limit <amount>", "One-time spending limit")
    .action(async () => {
        console.log("TODO: Build atomic group → Intermezzo sign → broadcast");
    });

program
    .command("trade <amount> <from> <to>")
    .description("Swap tokens via Vestige DEX aggregator")
    .option("--slippage <pct>", "Slippage tolerance", "2")
    .option("--dry-run", "Simulate without executing")
    .action(async () => {
        console.log("TODO: Vestige routing → atomic group → sign → broadcast");
    });

// --- x402 commands ---
const x402 = program.command("x402").description("x402 protocol commands");
const bazaar = x402
    .command("bazaar")
    .description("GoPlausible Bazaar commands");

bazaar
    .command("search <query>")
    .description("Search for x402 services")
    .option("--category <cat>", "Filter by category")
    .action(async () => {
        console.log("TODO: Query GoPlausible /discovery/resources");
    });

x402
    .command("pay <url>")
    .description("Pay for an x402 service")
    .action(async () => {
        console.log("TODO: Parse 402 → sign → send → retry with auth header");
    });

// --- Funding commands ---
program
    .command("fund")
    .description("Fund wallet with USDC")
    .option("--watch", "Watch for incoming deposits")
    .action(async () => {
        console.log("TODO: Show address + Pera Fund link");
    });

// --- Monetize command ---
program
    .command("monetize <endpoint>")
    .description("Monetize an API endpoint with x402 paywall")
    .action(async () => {
        console.log("TODO: Deploy x402 paywall + register on Bazaar");
    });

// --- Config commands ---
const configCmd = program
    .command("config")
    .description("Configuration management");

configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
        const config = getConfig();
        config.set(key as any, value);
        console.log(`Set ${key} = ${value}`);
    });

configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action(async (key: string) => {
        const config = getConfig();
        const value = config.get(key as any);
        console.log(value ?? "(not set)");
    });

configCmd
    .command("set-limit <amount> <period>")
    .description("Set spending limit (period: hourly|daily|weekly|monthly)")
    .action(async (amount: string, period: string) => {
        console.log(`TODO: Store spending limit ${amount} per ${period}`);
    });

configCmd
    .command("get-limit")
    .description("Get current spending limit")
    .action(async () => {
        console.log("TODO: Show current spending limit");
    });

// --- Batch commands ---
program
    .command("batch <file>")
    .description("Execute batch transactions from JSON file")
    .action(async () => {
        console.log("TODO: Parse batch file → atomic groups → execute");
    });

// --- Webhook commands ---
const webhook = program
    .command("webhook")
    .description("Webhook management");

webhook
    .command("add <url>")
    .description("Register a webhook")
    .option("--events <events>", "Filter by events (comma-separated)")
    .action(async () => {
        console.log("TODO: Register webhook");
    });

webhook
    .command("list")
    .description("List registered webhooks")
    .action(async () => {
        console.log("TODO: List webhooks");
    });

webhook
    .command("remove <id>")
    .description("Remove a webhook")
    .action(async () => {
        console.log("TODO: Remove webhook");
    });

// --- Dashboard ---
program
    .command("show")
    .description("Open the web dashboard")
    .action(async () => {
        console.log("TODO: Open dashboard URL in browser");
    });

// --- Parse and run ---
program.parse(process.argv);
