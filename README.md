# PIXA - Algorand Wallet for AI Agents

> Give AI agents the power to transact autonomously on Algorand using x402 micropayments

## 🎯 The Problem

AI agents are becoming increasingly autonomous, but they lack a fundamental capability: **the ability to pay for resources independently**. Current solutions require:

- Manual API key management
- Pre-configured billing accounts
- Human intervention for every new service
- Complex subscription models that don't fit agent workflows

This creates a bottleneck where agents can reason, plan, and execute tasks, but cannot complete transactions without human setup. They're intelligent but financially dependent.

## 💡 The Solution

**PIXA** is a full-featured Algorand wallet designed specifically for AI agents, enabling autonomous payments through the x402 protocol. It allows agents to:

- ✅ Discover and pay for services automatically
- ✅ Handle micropayments (sub-cent transactions)
- ✅ Manage USDC and ALGO balances
- ✅ Swap tokens on Tinyman DEX
- ✅ Create custom ASA tokens
- ✅ Operate within configurable budget limits

## 🔧 What is x402?

**x402** is an HTTP-native payment protocol that enables instant, on-chain micropayments for API access. It works by:

1. **Client requests a resource** → Server responds with `402 Payment Required`
2. **Server includes payment terms** → Amount, recipient, network details
3. **Agent signs payment authorization** → USDC transfer authorization on Algorand
4. **Agent retries with payment header** → Server verifies and returns resource

This happens in seconds, with no human intervention, no API keys, and no pre-configured accounts.

### Why x402 + Algorand?

- **Instant finality** - Algorand's 3.3s block time enables real-time payments
- **Low fees** - ~$0.001 per transaction, perfect for micropayments
- **Pure Proof of Stake** - Energy-efficient and sustainable
- **Native USDC** - Circle's USDC is native to Algorand, no bridging needed

## 🚀 Features

### Core Wallet Operations

- **check_balance** - View USDC and ALGO balances
- **transfer_usdc** - Send USDC to any Algorand address (supports NFD names)
- **transfer_algo** - Send ALGO for gas fees
- **spending_report** - Track spending history and budget usage
- **request_funding** - Generate Algorand payment URIs for funding

### x402 Payment Protocol

- **pay** - Sign x402 payment authorizations
- **x402_fetch** - Fetch URLs with automatic x402 payment handling
- **search_bazaar** - Discover x402-gated AI services

### DeFi Integration

- **tinyman_swap** - Swap tokens on Tinyman DEX
- **create_token** - Create custom ASA tokens on Algorand

## 📦 Installation Options

### Publishable npm Package

The MCP server package is designed to publish as `pixa-wallet-mcp`, so developers can install it directly with:

```json
{
  "mcpServers": {
    "pixa": {
      "command": "npx",
      "args": ["-y", "pixa-wallet-mcp"],
      "env": {
        "ALGORAND_MNEMONIC": "your 25-word mnemonic",
        "NETWORK": "algorand-testnet",
        "MAX_PER_CALL": "0.10",
        "MAX_PER_DAY": "20.00"
      }
    }
  }
}
```

### For Non-Technical Users: .mcpb Extension

Download and double-click `pixa.mcpb` - that's it! The extension installs automatically in Claude Desktop.

**Download:** [Latest Release](https://github.com/soumyacodes007/algorand-wallet/releases/latest)

### For Technical Users: JSON Configuration

Add to your MCP config file:

```json
{
  "mcpServers": {
    "pixa": {
      "command": "npx",
      "args": ["-y", "pixa-wallet-mcp"],
      "env": {
        "ALGORAND_MNEMONIC": "your 25-word mnemonic",
        "NETWORK": "algorand-testnet",
        "MAX_PER_CALL": "0.10",
        "MAX_PER_DAY": "20.00"
      }
    }
  }
}
```

**Config locations:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## 🏗️ Architecture

```

## 🗂️ Repository Layout

The repo is split so the npm-publishable MCP package stays clean at the root, while demo and deployment assets live in grouped folders:

- `src/`, `dist/`, `__tests__/`, `scripts/` — publishable MCP server package
- `services/pixa-hub/` — backend treasury payment service
- `examples/algorand-apis/` — Algorand API experiments and seller examples
- `examples/pizza-api/` — example paid API used in demos
- `apps/onramp-hosting/` — externally hosted Onramp UI
- `sandbox/preview/` — local browser preview pages
- `sandbox/tmp-mcpb-check/` — unpacked MCP bundle inspection output
- `docs/pitch/` — pitch materials and judging prep
┌─────────────────┐
│   AI Agent      │
│  (Claude, etc)  │
└────────┬────────┘
         │ MCP Protocol
         ▼
┌─────────────────┐
│  PIXA Wallet    │
│  MCP Server     │
├─────────────────┤
│ • Balance Check │
│ • Transfers     │
│ • x402 Payments │
│ • DEX Swaps     │
│ • Token Creation│
└────────┬────────┘
         │ Algorand SDK
         ▼
┌─────────────────┐
│   Algorand      │
│   Blockchain    │
└─────────────────┘
```

## 🔐 Security Features

- **Budget Limits** - Configurable max per call and daily spending caps
- **Spending Tracking** - Complete audit trail of all transactions
- **Secure Key Storage** - Mnemonics stored in OS keychain (for .mcpb)
- **NFD Resolution** - Human-readable names instead of raw addresses
- **Transaction Confirmation** - Wait for on-chain confirmation before proceeding

## 🎮 Try It Live

Test PIXA with our Unified AI Layer endpoint:

```
https://unified-agent-layer-production.up.railway.app/v1/chat
```

**Ask your AI agent:**

> "Access https://unified-agent-layer-production.up.railway.app/v1/chat and ask it to explain quantum computing"

The agent will:

1. Detect the 402 payment requirement ($0.005)
2. Sign a USDC payment authorization
3. Retry with payment header
4. Return the AI response

## 🔮 Future Roadmap

### 1. On-Ramp/Off-Ramp via Mudrex

Enable agents to convert fiat ↔ crypto autonomously, removing the need for users to manually fund wallets.

### 2. Multi-Chain x402 Support

Expand to Ethereum, Polygon, and other chains while keeping **Algorand as the settlement layer** for:

- Final settlement of cross-chain transactions
- Dispute resolution
- Proof aggregation

### 3. Robust On-Chain Guardrails

- Smart contract-based spending limits
- Multi-sig requirements for large transactions
- Time-locked payments
- Whitelist/blacklist for recipient addresses

### 4. CLI Version

Command-line interface for:

- Server deployments
- CI/CD integration
- Headless agent environments
- Advanced scripting and automation

## 🛠️ Technical Stack

- **Language:** TypeScript
- **Runtime:** Node.js 18+
- **Protocol:** Model Context Protocol (MCP)
- **Blockchain:** Algorand
- **SDK:** AlgoSDK, @x402-avm
- **Package Format:** .mcpb (MCP Bundle)

## 📊 Use Cases

### 1. Autonomous Research Agents

Agents that need to access paid research databases, academic papers, or specialized APIs.

### 2. Content Creation Agents

AI agents that pay for image generation, video processing, or premium content APIs.

### 3. Data Analysis Agents

Agents that purchase real-time market data, weather data, or other premium datasets.

### 4. Multi-Agent Collaboration

Agents paying other agents for specialized services in a decentralized marketplace.

## 🏆 Hackathon Highlights

### Innovation

- First full-featured Algorand wallet designed specifically for AI agents
- Seamless integration of x402 protocol with MCP
- Dual installation methods (technical and non-technical users)

### Technical Excellence

- 10 comprehensive tools covering wallet, DeFi, and payments
- Built-in budget controls and spending tracking
- NFD name resolution for user-friendly addresses
- Tinyman DEX integration for token swaps

### User Experience

- One-click installation via .mcpb for non-technical users
- Simple JSON config for developers
- Automatic payment handling - agents "just work"
- Real-time transaction confirmation

### Algorand Integration

- Native USDC support (no bridging)
- Tinyman DEX integration
- ASA token creation
- NFD name resolution
- Pure Proof of Stake benefits

## 📝 License

MIT License - See [LICENSE](LICENSE) for details

## 🔗 Links

- **Website:** [pixa-wallet.vercel.app](https://pixa-wallet.vercel.app)
- **GitHub:** [github.com/soumyacodes007/algorand-wallet](https://github.com/soumyacodes007/algorand-wallet)
- **Unified AI Layer:** [unified-agent-layer-production.up.railway.app](https://unified-agent-layer-production.up.railway.app)

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines for more details.

---

**Built with ❤️ for the Algorand ecosystem**

_Empowering AI agents to transact autonomously, one micropayment at a time._
