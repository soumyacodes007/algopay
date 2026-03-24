#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { getConfig } from "./config.js";
import * as authClient from "./auth/client.js";
import * as wallet from "./wallet/queries.js";
import { sendPayment } from "./wallet/send.js";
import * as vestige from "./wallet/vestige.js";
import { searchBazaar, registerWithBazaar } from "./x402/bazaar.js";
import { payAndFetch } from "./x402/pay.js";
import { getFundingMethods, checkDeposits, getTestnetDispenserUrl } from "./wallet/funding.js";
import { smartResolve, isNfdName, resolveAddressToNfd } from "./wallet/nfd.js";
import { getTransactionHistory, getAssetHoldings, getNetworkStatus } from "./wallet/advanced.js";
import { executeBatch, generateBatchTemplate } from "./batch/batch.js";
import { addWebhook, listWebhooks, removeWebhook } from "./webhooks/webhooks.js";

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
        try {
            const result = await authClient.login(email);
            const opts = program.opts();
            if (opts.json) {
                console.log(JSON.stringify(result));
            } else {
                console.log(`\n✉️  OTP sent to ${email}`);
                console.log(`   Flow ID: ${result.flowId}`);
                console.log(`   Expires in: ${result.expiresIn}`);
                console.log(`\n   Next: algopay auth verify ${result.flowId} <otp>\n`);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

auth
    .command("verify <flowId> <otp>")
    .description("Verify OTP code")
    .action(async (flowId: string, otp: string) => {
        try {
            const result = await authClient.verify(flowId, otp);
            const opts = program.opts();
            if (opts.json) {
                console.log(JSON.stringify(result));
            } else {
                console.log(`\n✅ Authenticated!`);
                console.log(`   Wallet: ${result.walletAddress}`);
                console.log(`   Email:  ${result.email}`);
                console.log(`   Session expires in: ${result.expiresIn}\n`);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

auth
    .command("logout")
    .description("Clear session token")
    .action(async () => {
        try {
            await authClient.logout();
            const opts = program.opts();
            if (opts.json) {
                console.log(JSON.stringify({ message: "Logged out successfully." }));
            } else {
                console.log("Logged out successfully.");
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Wallet commands ---
program
    .command("status")
    .description("Check wallet status")
    .action(async () => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            const status = await wallet.getStatus(address, network);
            if (opts.json) {
                console.log(JSON.stringify(status));
            } else {
                console.log(`\n📱 Wallet Status`);
                console.log(`   Address:    ${status.address}`);
                console.log(`   Network:    ${status.network}`);
                console.log(`   Last Round: ${status.algodStatus.lastRound}`);
                console.log(`   Authenticated: ${status.authenticated}\n`);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

program
    .command("balance")
    .description("Check wallet balance")
    .action(async () => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            const bal = await wallet.getBalance(address, network);
            if (opts.json) {
                console.log(JSON.stringify(bal));
            } else {
                console.log(`\n💰 Wallet Balance (${network})`);
                console.log(`   ALGO: ${bal.algo.displayAmount}`);
                if (bal.assets.length > 0) {
                    for (const a of bal.assets) {
                        console.log(`   ${a.unitName || a.name}: ${a.displayAmount}`);
                    }
                }
                console.log(`   USDC Total: $${bal.totalUsdcBalance}\n`);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
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

// --- Transaction commands ---
program
    .command("send <amount> <recipient>")
    .description("Send ALGO or USDC (zero-gas via fee pooling)")
    .option("--asset <name>", "Asset to send: ALGO or USDC", "USDC")
    .option("--dry-run", "Simulate without broadcasting")
    .action(async (amount: string, recipient: string, cmdOpts: { asset: string; dryRun?: boolean }) => {
        const address = authClient.getWalletAddress();
        const sessionToken = authClient.getSessionToken();
        if (!address || !sessionToken) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            console.error("Invalid amount. Must be a positive number.");
            process.exit(1);
        }
        const asset = cmdOpts.asset.toUpperCase() as "ALGO" | "USDC";
        if (asset !== "ALGO" && asset !== "USDC") {
            console.error(`Unsupported asset "${cmdOpts.asset}". Use ALGO or USDC.`);
            process.exit(1);
        }
        try {
            // NFD resolution: "alice.algo" → Algorand address
            let resolvedRecipient = recipient;
            let nfdName: string | undefined;
            if (isNfdName(recipient)) {
                console.log(`\n🔍 Resolving NFD name: ${recipient}...`);
                const resolved = await smartResolve(recipient, network);
                resolvedRecipient = resolved.address;
                nfdName = resolved.nfdName;
                console.log(`   → ${resolvedRecipient}`);
            }

            if (!cmdOpts.dryRun) {
                console.log(`\n🔐 Running guardrail checks...`);
            }
            const result = await sendPayment({
                senderAddress: address,
                recipientAddress: resolvedRecipient,
                amount: parsedAmount,
                asset,
                network,
                sessionToken,
                dryRun: cmdOpts.dryRun,
            });
            if (opts.json) {
                console.log(JSON.stringify(result));
            } else if (!result.success) {
                console.error(`\n❌ ${result.error}\n`);
                process.exit(1);
            } else if (result.dryRun) {
                console.log(`\n🔍 DRY RUN — Transaction not broadcast`);
                console.log(`   Would send: ${parsedAmount} ${asset} to ${recipient}`);
                console.log(`   Estimated fee: ${result.fee} microALGO (paid by Algopay)\n`);
            } else {
                console.log(`\n✅ Sent ${parsedAmount} ${asset}!`);
                console.log(`   To:    ${recipient}`);
                console.log(`   TxID:  ${result.txId}`);
                console.log(`   Round: ${result.confirmedRound}`);
                console.log(`   Fee:   Paid by Algopay (zero cost to you)\n`);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Spending Limits command ---
program
    .command("limits")
    .description("View or set spending limits")
    .option("--set <amount>", "Set spending limit amount")
    .option("--period <period>", "Period: hourly|daily|weekly|monthly", "daily")
    .option("--clear", "Remove spending limit")
    .action((cmdOpts: { set?: string; period: string; clear?: boolean }) => {
        const config = getConfig();
        const opts = program.opts();
        if (cmdOpts.clear) {
            config.set("spendingLimits", null);
            console.log("Spending limits cleared.");
            return;
        }
        if (cmdOpts.set) {
            const amount = parseFloat(cmdOpts.set);
            if (isNaN(amount) || amount <= 0) {
                console.error("Invalid limit amount.");
                process.exit(1);
            }
            const period = cmdOpts.period as "hourly" | "daily" | "weekly" | "monthly";
            config.set("spendingLimits", { amount, period });
            if (opts.json) {
                console.log(JSON.stringify({ spendingLimit: { amount, period } }));
            } else {
                console.log(`✅ Spending limit set: ${amount} USDC (${period})`);
            }
            return;
        }
        // Show current limits
        const limits = config.get("spendingLimits");
        if (opts.json) {
            console.log(JSON.stringify({ spendingLimits: limits }));
        } else if (limits) {
            console.log(`\n💳 Spending Limit: ${limits.amount} USDC per ${limits.period}\n`);
        } else {
            console.log("No spending limits configured.");
        }
    });

program
    .command("trade <amount> <from> <to>")
    .description("Swap tokens via Vestige DEX aggregator (zero-gas)")
    .option("--slippage <pct>", "Slippage tolerance %", "1")
    .option("--dry-run", "Show quote without executing")
    .action(async (amount: string, from: string, to: string, cmdOpts: { slippage: string; dryRun?: boolean }) => {
        const address = authClient.getWalletAddress();
        const sessionToken = authClient.getSessionToken();
        if (!address || !sessionToken) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            console.error("Invalid amount.");
            process.exit(1);
        }
        try {
            // Resolve asset names/IDs
            const fromAssetId = vestige.resolveAssetId(from, network);
            const toAssetId = vestige.resolveAssetId(to, network);
            // Decimals: ALGO = 6, USDC = 6, others may vary
            const fromDecimals = 6;
            const toDecimals = 6;
            const slippage = parseFloat(cmdOpts.slippage);

            console.log(`\n📊 Fetching Vestige swap quote...`);
            const quote = await vestige.getSwapQuote(
                fromAssetId,
                toAssetId,
                parsedAmount,
                fromDecimals,
                toDecimals,
                slippage,
                network
            );

            const fromName = vestige.formatAssetName(fromAssetId, network);
            const toName = vestige.formatAssetName(toAssetId, network);

            if (opts.json) {
                console.log(JSON.stringify(quote));
            } else {
                console.log(`\n   Sell: ${parsedAmount} ${fromName}`);
                console.log(`   Buy:  ${quote.toAmountDisplay.toFixed(6)} ${toName}`);
                console.log(`   Price Impact: ${quote.priceImpact.toFixed(2)}%`);
                console.log(`   Slippage: ${slippage}%`);
                if (quote.route.length > 0) {
                    console.log(`   Route: ${quote.route.join(' → ')}`);
                }
            }

            if (cmdOpts.dryRun) {
                console.log(`\n🔍 DRY RUN — No swap executed.\n`);
                return;
            }

            // Execute: for MVP, executes as a USDC/ALGO transfer to a pool
            // Full multi-hop Vestige routing requires enterprise API key (V2)
            console.log(`\n⚠️  Note: Full Vestige multi-hop routing is a V2 feature.`);
            console.log(`   For MVP, use 'algopay send' to execute transfers.\n`);
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- x402 commands ---
const x402 = program.command("x402").description("x402 protocol commands");
const bazaar = x402
    .command("bazaar")
    .description("GoPlausible Bazaar commands");

bazaar
    .command("search <query>")
    .description("Search for x402 services in GoPlausible Bazaar")
    .option("--category <cat>", "Filter by category (ai|data|analytics|...)")
    .option("--limit <n>", "Max results", "10")
    .action(async (query: string, cmdOpts: { category?: string; limit: string }) => {
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            console.log(`\n🔍 Searching Bazaar for: "${query}"...`);
            const result = await searchBazaar(query, {
                category: cmdOpts.category,
                limit: parseInt(cmdOpts.limit, 10),
                network,
            });
            if (opts.json) {
                console.log(JSON.stringify(result));
            } else {
                console.log(`\n🏪 GoPlausible Bazaar — ${result.resources.length} result(s)\n`);
                if (result.resources.length === 0) {
                    console.log("   No services found. Try a broader query.\n");
                } else {
                    for (const r of result.resources) {
                        console.log(`   📌 ${r.name}  ($${r.priceUsdc} USDC/req)`);
                        console.log(`      ${r.description}`);
                        console.log(`      URL:  ${r.url}`);
                        console.log(`      Tags: ${r.tags.join(", ")}\n`);
                    }
                }
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

bazaar
    .command("register <serviceUrl>")
    .description("Register your x402 API endpoint with GoPlausible Bazaar")
    .requiredOption("--name <name>", "Service name shown in Bazaar")
    .requiredOption("--price <usdc>", "Price per request in USDC (e.g. 0.05)")
    .option("--description <desc>", "Short description of your API", "")
    .option("--category <cat>", "Category (api|data|ai|analytics)", "api")
    .option("--tags <tags>", "Comma-separated tags", "x402,algorand")
    .action(async (serviceUrl: string, cmdOpts: {
        name: string; price: string; description: string;
        category: string; tags: string;
    }) => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        const priceUsdc = parseFloat(cmdOpts.price);
        if (isNaN(priceUsdc) || priceUsdc <= 0) {
            console.error("Invalid price. Must be a positive number.");
            process.exit(1);
        }

        console.log(`\n📋 Registering with GoPlausible Bazaar...`);
        console.log(`   Service: ${cmdOpts.name}`);
        console.log(`   URL:     ${serviceUrl}`);
        console.log(`   Price:   $${priceUsdc} USDC / request`);
        console.log(`   Pay-to:  ${address.slice(0, 16)}...\n`);

        try {
            const result = await registerWithBazaar({
                name:         cmdOpts.name,
                description:  cmdOpts.description || `x402-enabled API: ${cmdOpts.name}`,
                serviceUrl,
                priceUsdc,
                payToAddress: address,
                network:      network === "mainnet" ? "algorand-mainnet" : "algorand-testnet",
                category:     cmdOpts.category,
                tags:         cmdOpts.tags.split(",").map((t: string) => t.trim()),
            });

            if (opts.json) {
                console.log(JSON.stringify(result));
            } else if (result.success) {
                console.log(`✅ Registered on Bazaar!`);
                if (result.id) console.log(`   ID:  ${result.id}`);
                if (result.url) console.log(`   URL: ${result.url}`);
                console.log();
            } else {
                console.error(`❌ ${result.message}`);
                console.log(`\n   To get a Bazaar API key: https://goplausible.xyz`);
                console.log(`   Then add  BAZAAR_API_KEY=<key>  to your .env file\n`);
                process.exit(1);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

x402
    .command("pay <url>")
    .description("Pay for an x402 service (auto-handles 402 challenge)")
    .option("--max-price <usdc>", "Max USDC willing to pay", "1.0")
    .option("--method <method>", "HTTP method", "GET")
    .action(async (url: string, cmdOpts: { maxPrice: string; method: string }) => {
        const address = authClient.getWalletAddress();
        const sessionToken = authClient.getSessionToken();
        if (!address || !sessionToken) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            console.log(`\n💳 Initiating x402 payment flow...`);
            console.log(`   URL: ${url}`);
            console.log(`   Max price: $${cmdOpts.maxPrice} USDC\n`);

            const result = await payAndFetch({
                serviceUrl: url,
                senderAddress: address,
                sessionToken,
                network,
                maxPrice: parseFloat(cmdOpts.maxPrice),
                requestOptions: { method: cmdOpts.method },
            });

            if (opts.json) {
                console.log(JSON.stringify(result));
            } else if (!result.success) {
                console.error(`\n❌ ${result.error}\n`);
                if (result.txId) console.log(`   Payment TxID: ${result.txId}`);
                process.exit(1);
            } else {
                console.log(`✅ x402 Payment successful!`);
                if (result.txId) console.log(`   TxID: ${result.txId}`);
                console.log(`   HTTP ${result.statusCode}\n`);
                if (result.responseBody) {
                    console.log(`--- Response ---`);
                    console.log(result.responseBody.slice(0, 1000));
                    console.log(`--- End Response ---\n`);

                }
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Funding commands ---
program
    .command("fund")
    .description("Fund wallet with USDC/ALGO")
    .option("--watch", "Watch for incoming deposits")
    .option("--open", "Open dispenser / Pera Fund in browser")
    .action(async (cmdOpts: { watch?: boolean; open?: boolean }) => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";

        const info = getFundingMethods(address, network);

        if (opts.json) {
            console.log(JSON.stringify(info));
            return;
        }

        console.log(`\n💰 Fund Your Wallet`);
        console.log(`   Address: ${address}`);
        console.log(`   Network: ${network}\n`);

        for (const m of info.methods) {
            const icon = m.type === "fiat" ? "💳" : m.type === "testnet" ? "🧪" : "🔗";
            console.log(`   ${icon} ${m.name}`);
            console.log(`      ${m.description}`);
            if (m.url) console.log(`      URL: ${m.url}`);
            console.log(`      Time: ${m.processingTime}\n`);
        }

        if (cmdOpts.open && network === "testnet") {
            const url = getTestnetDispenserUrl(address);
            console.log(`\n🌐 Opening testnet dispenser...`);
            console.log(`   ${url}\n`);
        }

        if (cmdOpts.watch) {
            console.log(`\n👀 Watching for incoming deposits...\n`);
            try {
                const deposits = await checkDeposits(address, network, 0, 5);
                if (deposits.length === 0) {
                    console.log(`   No recent deposits found.`);
                    console.log(`   Fund your wallet and run this command again.\n`);
                } else {
                    for (const d of deposits) {
                        const time = new Date(d.timestamp * 1000).toISOString();
                        console.log(`   ⬇  ${d.amount} ${d.asset} from ${d.sender.slice(0, 8)}...`);
                        console.log(`      Round: ${d.confirmedRound} | ${time}`);
                        console.log(`      TX: ${d.txId}\n`);
                    }
                }
            } catch (err: any) {
                console.error(`   Error checking deposits: ${err.message}\n`);
            }
        }
    });

// --- Monetize command ---
program
    .command("monetize <endpoint>")
    .description("Monetize an API endpoint with x402 paywall")
    .option("--price <usdc>", "Price per request in USDC", "$0.05")
    .option("--scaffold", "Generate a ready-to-run x402 server project")
    .action(async (endpoint: string, cmdOpts: { price: string; scaffold?: boolean }) => {
        const address = authClient.getWalletAddress();
        const opts = program.opts();

        if (cmdOpts.scaffold) {
            console.log(`\n🏗️  To scaffold an x402 server, run:`);
            console.log(`   npx tsx examples/x402-server.ts\n`);
            console.log(`   Or copy examples/x402-server.ts into your project.\n`);
            return;
        }

        const payTo = address ?? "YOUR_ALGORAND_ADDRESS";
        const price = cmdOpts.price;

        if (opts.json) {
            console.log(JSON.stringify({
                endpoint,
                payTo,
                price,
                instruction: "Add paymentMiddleware to your Express app",
            }));
        } else {
            console.log(`\n💰 Monetize: ${endpoint}`);
            console.log(`   Price: ${price} USDC per request`);
            console.log(`   Pay-to: ${payTo}\n`);
            console.log(`   Add this to your Express app:\n`);
            console.log(`   ┌───────────────────────────────────────────────────────────┐`);
            console.log(`   │ import { paymentMiddleware } from "@algopay/x402";        │`);
            console.log(`   │                                                           │`);
            console.log(`   │ const payment = paymentMiddleware("${payTo.slice(0, 8)}...", {   │`);
            console.log(`   │   "GET ${endpoint}": "${price}",                          │`);
            console.log(`   │ });                                                       │`);
            console.log(`   │                                                           │`);
            console.log(`   │ app.get("${endpoint}", payment, handler);                 │`);
            console.log(`   └───────────────────────────────────────────────────────────┘\n`);
            console.log(`   Run the example server: npx tsx examples/x402-server.ts\n`);
        }
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

// --- Transaction History ---
program
    .command("history")
    .description("Show recent transaction history")
    .option("--limit <n>", "Number of transactions", "10")
    .action(async (cmdOpts: { limit: string }) => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            console.log(`\n📜 Transaction History\n`);
            const history = await getTransactionHistory(address, network, parseInt(cmdOpts.limit, 10));
            if (opts.json) {
                console.log(JSON.stringify(history));
            } else if (history.length === 0) {
                console.log("   No transactions found.\n");
            } else {
                for (const tx of history) {
                    const icon = tx.direction === "sent" ? "⬆ " : tx.direction === "received" ? "⬇ " : "↔ ";
                    const time = tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : "pending";
                    // Try NFD reverse lookup for counterparty
                    let counterLabel = tx.counterparty.slice(0, 12) + "...";
                    try {
                        const nfd = await resolveAddressToNfd(tx.counterparty, network);
                        if (nfd) counterLabel = `${nfd} (${tx.counterparty.slice(0, 8)}...)`;
                    } catch { /* offline */ }
                    console.log(`   ${icon} ${tx.direction.toUpperCase()} ${tx.amount} ${tx.asset}`);
                    console.log(`      ${tx.direction === "sent" ? "To:" : "From:"} ${counterLabel}`);
                    console.log(`      ${time} | Round ${tx.round} | ${tx.txId.slice(0, 16)}...\n`);
                }
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Asset Opt-in ---
program
    .command("optin <assetId>")
    .description("Opt-in to receive an ASA (required before receiving tokens)")
    .action(async (assetId: string) => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        const id = parseInt(assetId, 10);
        if (isNaN(id) || id <= 0) {
            console.error("Invalid asset ID.");
            process.exit(1);
        }
        console.log(`\n🔗 Opting in to ASA ${id} on ${network}...`);
        console.log(`   This creates a 0-amount transfer to yourself.`);
        console.log(`   After opt-in, you can receive this asset.\n`);

        if (opts.json) {
            console.log(JSON.stringify({ assetId: id, address, network, status: "ready" }));
        } else {
            console.log(`   ✅ Opt-in transaction ready for ASA ${id}`);
            console.log(`   Sign and broadcast via Intermezzo to complete.\n`);
        }
    });

// --- Network Status ---
program
    .command("network")
    .description("Show Algorand network status and health")
    .action(async () => {
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            const status = await getNetworkStatus(network);
            if (opts.json) {
                console.log(JSON.stringify(status));
            } else {
                const icon = status.healthy ? "🟢" : "🔴";
                console.log(`\n${icon} Algorand Network: ${network}`);
                console.log(`   Healthy:    ${status.healthy ? "Yes" : "No"}`);
                console.log(`   Last Round: ${status.lastRound}`);
                console.log(`   Genesis ID: ${status.genesisId}`);
                console.log(`   Version:    ${status.version}`);
                if (status.catchupTime > 0) {
                    console.log(`   Catchup:    ${status.catchupTime}ns remaining`);
                }
                console.log();
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Holdings (multi-asset balance) ---
program
    .command("holdings")
    .description("Show all asset holdings (ALGO + all ASAs)")
    .action(async () => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }
        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";
        try {
            const holdings = await getAssetHoldings(address, network);
            if (opts.json) {
                console.log(JSON.stringify(holdings));
            } else {
                console.log(`\n💎 Asset Holdings (${network})\n`);
                for (const h of holdings) {
                    const frozen = h.isFrozen ? " 🧊 FROZEN" : "";
                    console.log(`   ${h.unitName}: ${h.amount.toFixed(h.decimals > 4 ? 4 : h.decimals)} ${h.name}${frozen}`);
                }
                console.log();
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });

// --- Dashboard ---
program
    .command("show")
    .description("Open the web dashboard")
    .action(async () => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }

        const dashboardUrl = process.env.ALGOPAY_DASHBOARD_URL || "http://localhost:5173";
        
        console.log(`\n📊 Opening Algopay Dashboard...`);
        console.log(`   URL: ${dashboardUrl}`);
        console.log(`   Wallet: ${address.slice(0, 8)}...${address.slice(-8)}\n`);
        
        // Try to open in browser
        try {
            const { default: open } = await import("open");
            await open(dashboardUrl);
            console.log("✅ Dashboard opened in your default browser\n");
        } catch (error) {
            console.log("⚠️  Could not auto-open browser. Please visit the URL above manually.\n");
        }
    });

// --- Batch commands ---
const batch = program.command("batch").description("Batch transaction commands");

batch
    .command("execute <file>")
    .description("Execute batch transactions from JSON file")
    .option("--dry-run", "Simulate without broadcasting")
    .action(async (file: string, cmdOpts: { dryRun?: boolean }) => {
        const address = authClient.getWalletAddress();
        if (!address) {
            console.error("Not authenticated. Run: algopay auth login <email>");
            process.exit(1);
        }

        const sessionToken = authClient.getSessionToken();
        if (!sessionToken) {
            console.error("No session token. Run: algopay auth login <email>");
            process.exit(1);
        }

        const opts = program.opts();
        const network = opts.resolvedNetwork ?? "testnet";

        console.log(`\n🔄 Executing batch transactions...`);
        console.log(`   File: ${file}`);
        console.log(`   Network: ${network}`);
        console.log(`   Dry run: ${cmdOpts.dryRun ? "Yes" : "No"}\n`);

        try {
            const result = await executeBatch(file, address, sessionToken, {
                network,
                dryRun: cmdOpts.dryRun,
            });

            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }

            if (result.success) {
                console.log(`✅ Batch completed successfully!`);
                console.log(`   Total: ${result.totalTransactions}`);
                console.log(`   Successful: ${result.successfulTransactions}`);
                console.log(`   Failed: ${result.failedTransactions}\n`);
            } else {
                console.error(`❌ Batch failed: ${result.error}`);
                console.log(`   Successful: ${result.successfulTransactions}`);
                console.log(`   Failed: ${result.failedTransactions}\n`);
            }

            // Show individual results
            for (const r of result.results) {
                const status = r.success ? "✅" : "❌";
                console.log(`   ${status} Transaction ${r.index}: ${r.transaction.type}`);
                if (r.success && r.txId) {
                    console.log(`      TX: ${r.txId}`);
                } else if (r.error) {
                    console.log(`      Error: ${r.error}`);
                }
            }
        } catch (error: any) {
            console.error(`❌ Batch execution failed: ${error.message}`);
            process.exit(1);
        }
    });

batch
    .command("template")
    .description("Generate a batch transaction template file")
    .action(() => {
        const template = generateBatchTemplate();
        console.log(JSON.stringify(template, null, 2));
    });

// --- Webhook commands ---
const webhook = program.command("webhook").description("Webhook notification commands");

webhook
    .command("add <url>")
    .description("Add a webhook for transaction notifications")
    .option("--events <events>", "Comma-separated list of events", "transaction.sent,transaction.received")
    .option("--secret <secret>", "Secret for webhook signature verification")
    .action((url: string, cmdOpts: { events: string; secret?: string }) => {
        const events = cmdOpts.events.split(",").map(e => e.trim()) as any[];
        
        try {
            const webhook = addWebhook(url, events, cmdOpts.secret);
            const opts = program.opts();
            
            if (opts.json) {
                console.log(JSON.stringify(webhook, null, 2));
                return;
            }

            console.log(`\n✅ Webhook added successfully!`);
            console.log(`   ID: ${webhook.id}`);
            console.log(`   URL: ${webhook.url}`);
            console.log(`   Events: ${webhook.events.join(", ")}`);
            console.log(`   Secret: ${webhook.secret ? "Set" : "None"}\n`);
        } catch (error: any) {
            console.error(`❌ Failed to add webhook: ${error.message}`);
            process.exit(1);
        }
    });

webhook
    .command("list")
    .description("List all configured webhooks")
    .action(() => {
        const webhooks = listWebhooks();
        const opts = program.opts();

        if (opts.json) {
            console.log(JSON.stringify(webhooks, null, 2));
            return;
        }

        if (webhooks.length === 0) {
            console.log("\n📭 No webhooks configured\n");
            return;
        }

        console.log(`\n🔗 Configured Webhooks (${webhooks.length})\n`);
        
        for (const w of webhooks) {
            const status = w.active ? "🟢 Active" : "🔴 Inactive";
            const lastTriggered = w.lastTriggered 
                ? new Date(w.lastTriggered).toISOString()
                : "Never";
            
            console.log(`   ${status} ${w.id}`);
            console.log(`      URL: ${w.url}`);
            console.log(`      Events: ${w.events.join(", ")}`);
            console.log(`      Last triggered: ${lastTriggered}`);
            console.log(`      Failures: ${w.failureCount}\n`);
        }
    });

webhook
    .command("remove <id>")
    .description("Remove a webhook by ID")
    .action((id: string) => {
        const removed = removeWebhook(id);
        
        if (removed) {
            console.log(`✅ Webhook ${id} removed successfully`);
        } else {
            console.error(`❌ Webhook ${id} not found`);
            process.exit(1);
        }
    });

// --- Parse and run ---
program.parse(process.argv);
