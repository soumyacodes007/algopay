# Requirements Document

## Introduction

Algopay is a production-ready agentic payment wallet for the Algorand blockchain that enables AI agents and users to autonomously manage funds, make payments, and trade tokens. It provides AWAL-compatible user experience while leveraging Algorand's advantages: 3.3-second finality, lower fees, native fee pooling, and dual protocol support (x402 + AP2). The system routes all cryptographic operations through Intermezzo (Algorand Foundation's custodial API on HashiCorp Vault) to ensure keys never touch agent/LLM contexts, providing TEE-like security for autonomous operations.

## Glossary

- **Algopay_CLI**: The command-line interface executable via `npx algopay` that provides user and agent access to wallet functionality
- **MCP_Runtime**: Model Context Protocol runtime layer that orchestrates algorand-mcp server and algorand-remote-mcp-lite
- **Intermezzo**: Algorand Foundation's custodial signing service built on HashiCorp Vault that isolates private keys from application logic
- **Backend_Service**: FastAPI-based service hosted on Render/Railway/AWS that handles authentication, guardrails, and transaction building
- **ARC58_Wallet**: On-chain smart wallet contract following ARC-58 standard with fee pooling and plugin support
- **Fee_Pooling**: Mechanism where backend wallet pays all transaction fees in atomic groups, providing gasless UX
- **Atomic_Group**: Algorand transaction primitive that ensures multiple transactions execute atomically or all fail
- **GoPlausible_OAuth**: Authentication provider for email OTP and OAuth flows
- **Vestige_MCP**: DEX aggregator MCP integration providing optimal swap routing across Tinyman and Humble
- **x402_Protocol**: Payment protocol for AI-payable services via GoPlausible Bazaar
- **AP2_Protocol**: Alternative payment protocol supported by ARC-58 wallet
- **KYT**: Know Your Transaction - risk screening and blocklist checking
- **Guardrails**: Spending limits, reputation checks, and transaction validation rules
- **AlgoKit**: Algorand development toolkit used for building atomic transaction groups
- **Indexer**: Algorand indexer service for querying blockchain state and transaction history
- **Dashboard**: React-based web interface hosted on Vercel for wallet visualization
- **FlowId**: Session identifier returned by GoPlausible OAuth during authentication flow
- **USDC**: Native USD Coin asset on Algorand blockchain


## Requirements

### Requirement 1: CLI Installation and Initialization

**User Story:** As a developer or AI agent, I want to install and initialize Algopay via npx, so that I can start using the wallet without complex setup.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL be executable via `npx algopay` without prior installation
2. WHEN the Algopay_CLI is first executed, THE Algopay_CLI SHALL initialize the MCP_Runtime with algorand-mcp server and algorand-remote-mcp-lite
3. THE Algopay_CLI SHALL support `--network testnet` and `--network mainnet` flags on all commands
4. THE Algopay_CLI SHALL support `--json` output flag on all commands
5. WHEN initialization fails, THE Algopay_CLI SHALL return a descriptive error message with troubleshooting steps

### Requirement 2: Email-Based Authentication

**User Story:** As a user, I want to authenticate using my email address, so that I can securely access my wallet without managing private keys.

#### Acceptance Criteria

1. WHEN a user executes `algopay auth login <email>`, THE Algopay_CLI SHALL send the email to GoPlausible_OAuth
2. WHEN GoPlausible_OAuth receives a valid email, THE Backend_Service SHALL generate an OTP and return a FlowId
3. THE Algopay_CLI SHALL display the FlowId and prompt the user to check their email for the OTP
4. WHEN the email format is invalid, THE Algopay_CLI SHALL return an error message without contacting GoPlausible_OAuth
5. THE Backend_Service SHALL set OTP expiration to 10 minutes from generation time

### Requirement 3: OTP Verification and Wallet Attachment

**User Story:** As a user, I want to verify my OTP code, so that I can complete authentication and access my wallet.

#### Acceptance Criteria

1. WHEN a user executes `algopay auth verify <flowId> <otp>`, THE Algopay_CLI SHALL send the verification request to Backend_Service
2. WHEN the OTP matches and is not expired, THE Backend_Service SHALL complete authentication with GoPlausible_OAuth
3. WHEN authentication succeeds, THE Intermezzo SHALL create a new ARC58_Wallet or attach an existing wallet to the session
4. THE Backend_Service SHALL return the wallet address and session token to Algopay_CLI
5. THE Algopay_CLI SHALL store the session token securely in local configuration
6. WHEN the OTP is invalid or expired, THE Backend_Service SHALL return an error and increment the failed attempt counter
7. WHEN failed attempts exceed 3 for a FlowId, THE Backend_Service SHALL invalidate the FlowId


### Requirement 4: Wallet Status Query

**User Story:** As a user or AI agent, I want to check my wallet status, so that I can verify connectivity and view basic wallet information.

#### Acceptance Criteria

1. WHEN a user executes `algopay status`, THE Algopay_CLI SHALL query the MCP_Runtime for wallet state
2. THE MCP_Runtime SHALL retrieve wallet status from Intermezzo, ARC58_Wallet state, and Indexer
3. THE Algopay_CLI SHALL display wallet address, network, authentication status, and last sync time
4. WHEN the session is not authenticated, THE Algopay_CLI SHALL return an error prompting authentication
5. WHEN `--json` flag is provided, THE Algopay_CLI SHALL output status in JSON format

### Requirement 5: Balance Query

**User Story:** As a user or AI agent, I want to check my wallet balance, so that I can know how much USDC and other assets I have available.

#### Acceptance Criteria

1. WHEN a user executes `algopay balance`, THE Algopay_CLI SHALL query the Indexer via MCP_Runtime
2. THE MCP_Runtime SHALL retrieve native ALGO balance and all ASA (Algorand Standard Asset) balances
3. THE Algopay_CLI SHALL display USDC balance prominently and list other assets
4. THE Algopay_CLI SHALL display balances with appropriate decimal precision for each asset
5. WHEN the wallet has no assets, THE Algopay_CLI SHALL display zero balances
6. WHEN `--json` flag is provided, THE Algopay_CLI SHALL output balances in JSON format with asset IDs

### Requirement 6: Wallet Address Retrieval

**User Story:** As a user or AI agent, I want to retrieve my wallet address, so that I can share it for receiving funds.

#### Acceptance Criteria

1. WHEN a user executes `algopay address`, THE Algopay_CLI SHALL retrieve the ARC58_Wallet address from local configuration
2. THE Algopay_CLI SHALL display the address in Algorand standard format
3. WHEN `--json` flag is provided, THE Algopay_CLI SHALL output the address in JSON format
4. WHEN the session is not authenticated, THE Algopay_CLI SHALL return an error prompting authentication

### Requirement 7: Dashboard Access

**User Story:** As a user, I want to open a web dashboard, so that I can visualize my wallet activity and transaction history.

#### Acceptance Criteria

1. WHEN a user executes `algopay show`, THE Algopay_CLI SHALL open the Dashboard URL in the default browser
2. THE Algopay_CLI SHALL pass the session token to Dashboard via secure URL parameter or local storage
3. THE Dashboard SHALL display wallet balance, recent transactions, and spending limits
4. THE Dashboard SHALL auto-refresh data every 30 seconds
5. WHEN the session token is invalid, THE Dashboard SHALL redirect to authentication


### Requirement 8: USDC Payment Transactions

**User Story:** As a user or AI agent, I want to send USDC to another address, so that I can make payments without paying transaction fees.

#### Acceptance Criteria

1. WHEN a user executes `algopay send <amount> <recipient>`, THE Algopay_CLI SHALL validate the amount and recipient address format
2. THE Backend_Service SHALL build an Atomic_Group with the USDC transfer and fee payment transactions
3. THE Backend_Service SHALL verify the wallet has sufficient USDC balance for the transfer
4. THE Backend_Service SHALL apply Guardrails including spending limits and KYT checks
5. WHEN Guardrails pass, THE Backend_Service SHALL send the unsigned Atomic_Group to Intermezzo
6. THE Intermezzo SHALL sign the transaction using the wallet's private key
7. THE Backend_Service SHALL submit the signed Atomic_Group to the Algorand network
8. THE Algopay_CLI SHALL display transaction ID and confirmation status
9. WHEN the recipient address is invalid, THE Algopay_CLI SHALL return an error without contacting Backend_Service
10. WHEN spending limits are exceeded, THE Backend_Service SHALL reject the transaction with a descriptive error
11. WHEN KYT screening flags the recipient, THE Backend_Service SHALL reject the transaction with a compliance error

### Requirement 9: Token Trading via DEX

**User Story:** As a user or AI agent, I want to swap tokens, so that I can exchange assets at optimal rates without paying transaction fees.

#### Acceptance Criteria

1. WHEN a user executes `algopay trade <amount> <from> <to>`, THE Algopay_CLI SHALL validate the amount and token identifiers
2. THE Backend_Service SHALL query Vestige_MCP for optimal swap routing across Tinyman and Humble DEXes
3. THE Vestige_MCP SHALL return the best route with expected output amount and price impact
4. THE Backend_Service SHALL build an Atomic_Group containing swap transactions and fee payment
5. THE Backend_Service SHALL apply Guardrails including spending limits and slippage protection
6. WHEN Guardrails pass, THE Backend_Service SHALL send the unsigned Atomic_Group to Intermezzo
7. THE Intermezzo SHALL sign the transaction using the wallet's private key
8. THE Backend_Service SHALL submit the signed Atomic_Group to the Algorand network
9. THE Algopay_CLI SHALL display the executed trade details including actual output amount
10. WHEN slippage exceeds 2 percent, THE Backend_Service SHALL reject the trade
11. WHEN liquidity is insufficient, THE Vestige_MCP SHALL return an error and Backend_Service SHALL relay it to Algopay_CLI

### Requirement 10: x402 Service Discovery

**User Story:** As a user or AI agent, I want to search for AI-payable services, so that I can discover services I can pay for programmatically.

#### Acceptance Criteria

1. WHEN a user executes `algopay x402 bazaar search <query>`, THE Algopay_CLI SHALL send the search query to GoPlausible Bazaar API
2. THE Algopay_CLI SHALL cache search results locally for 1 hour
3. THE Algopay_CLI SHALL display service name, description, price, and payment URL for each result
4. THE Algopay_CLI SHALL support pagination for results exceeding 20 items
5. WHEN `--json` flag is provided, THE Algopay_CLI SHALL output results in JSON format with full service metadata
6. WHEN the query returns no results, THE Algopay_CLI SHALL display a helpful message suggesting alternative queries


### Requirement 11: x402 Service Payment

**User Story:** As a user or AI agent, I want to pay for x402 services, so that I can access AI-payable services programmatically.

#### Acceptance Criteria

1. WHEN a user executes `algopay x402 pay <url>`, THE Algopay_CLI SHALL parse the x402 payment URL
2. THE MCP_Runtime SHALL retrieve payment details from the x402 endpoint
3. THE Backend_Service SHALL build an Atomic_Group with the x402 payment transaction and fee payment
4. THE Backend_Service SHALL include the GoPlausible facilitator address in the Atomic_Group
5. THE Backend_Service SHALL apply Guardrails including spending limits
6. WHEN Guardrails pass, THE Backend_Service SHALL send the unsigned Atomic_Group to Intermezzo
7. THE Intermezzo SHALL sign the transaction using the wallet's private key
8. THE Backend_Service SHALL submit the signed Atomic_Group to the Algorand network
9. THE Algopay_CLI SHALL display the payment confirmation and service access token
10. WHEN the x402 URL is malformed, THE Algopay_CLI SHALL return an error without contacting Backend_Service
11. WHEN the service is unavailable, THE MCP_Runtime SHALL return an error with retry guidance

### Requirement 12: Wallet Funding

**User Story:** As a user, I want to fund my wallet with USDC, so that I can make payments and trades.

#### Acceptance Criteria

1. WHEN a user executes `algopay fund`, THE Algopay_CLI SHALL display the ARC58_Wallet address
2. THE Algopay_CLI SHALL provide options to fund via Pera Fund, Circle onramp, or direct deposit
3. WHEN the user selects Pera Fund, THE Algopay_CLI SHALL open the Pera Fund URL with the wallet address pre-filled
4. WHEN the user selects Circle onramp, THE Algopay_CLI SHALL open the Circle onramp URL with the wallet address pre-filled
5. THE Algopay_CLI SHALL display instructions for direct USDC deposit including the asset ID
6. THE Algopay_CLI SHALL provide a `--watch` flag that polls the Indexer for incoming transactions

### Requirement 13: Service Monetization

**User Story:** As a developer, I want to monetize my service with x402, so that I can receive payments from AI agents.

#### Acceptance Criteria

1. WHEN a user executes `algopay monetize <endpoint>`, THE Algopay_CLI SHALL validate the endpoint URL format
2. THE Backend_Service SHALL deploy an x402 paywall configuration to GoPlausible
3. THE Backend_Service SHALL deploy an ARC58_Wallet plugin for revenue collection
4. THE Algopay_CLI SHALL return the x402 payment URL for the monetized endpoint
5. THE Algopay_CLI SHALL display configuration instructions for integrating the paywall
6. WHEN the endpoint is already monetized, THE Backend_Service SHALL return the existing x402 URL


### Requirement 14: Spending Limits Configuration

**User Story:** As a user or administrator, I want to configure spending limits, so that I can control how much the wallet can spend in a given time period.

#### Acceptance Criteria

1. WHEN a user executes `algopay config set-limit <amount> <period>`, THE Algopay_CLI SHALL validate the amount and period format
2. THE Backend_Service SHALL store the spending limit in the ARC58_Wallet state
3. THE Backend_Service SHALL support periods of hourly, daily, weekly, and monthly
4. WHEN a transaction would exceed the spending limit, THE Backend_Service SHALL reject the transaction
5. THE Algopay_CLI SHALL support `algopay config get-limit` to retrieve current spending limits
6. THE Backend_Service SHALL reset spending counters at the end of each period
7. WHEN `--limit <amount>` flag is provided on send or trade commands, THE Backend_Service SHALL apply a one-time limit for that transaction

### Requirement 15: KYT and Risk Screening

**User Story:** As a compliance officer, I want automatic risk screening on all transactions, so that the wallet does not interact with sanctioned addresses.

#### Acceptance Criteria

1. WHEN the Backend_Service receives a transaction request, THE Backend_Service SHALL check the recipient address against the blocklist
2. THE Backend_Service SHALL query the KYT oracle for risk scoring
3. WHEN the recipient address is on the blocklist, THE Backend_Service SHALL reject the transaction with a compliance error
4. WHEN the risk score exceeds the threshold of 75, THE Backend_Service SHALL reject the transaction with a risk warning
5. THE Backend_Service SHALL log all KYT checks with timestamp, address, and risk score
6. THE Backend_Service SHALL update the blocklist from the KYT oracle every 24 hours

### Requirement 16: Atomic Transaction Building

**User Story:** As a system component, I want to build atomic transaction groups, so that complex operations execute atomically with fee pooling.

#### Acceptance Criteria

1. WHEN the Backend_Service builds a transaction group, THE Backend_Service SHALL use AlgoKit for atomic group construction
2. THE Backend_Service SHALL include the user's transaction and the backend wallet's fee payment transaction in each Atomic_Group
3. THE Backend_Service SHALL set the fee field to zero on the user's transaction
4. THE Backend_Service SHALL calculate the total fee and set it on the backend wallet's transaction
5. THE Backend_Service SHALL assign group IDs to all transactions in the Atomic_Group
6. THE Backend_Service SHALL validate that the Atomic_Group is valid before sending to Intermezzo
7. WHEN the Atomic_Group is invalid, THE Backend_Service SHALL return a descriptive error with the validation failure reason


### Requirement 17: Intermezzo Signing Service Integration

**User Story:** As a security architect, I want all signing operations to go through Intermezzo, so that private keys never exist in application or agent contexts.

#### Acceptance Criteria

1. THE Backend_Service SHALL route all transaction signing requests to Intermezzo via REST API
2. THE Backend_Service SHALL never generate, store, or access private keys directly
3. THE Backend_Service SHALL never call raw algosdk signing functions
4. WHEN Intermezzo receives an unsigned transaction, THE Intermezzo SHALL validate the transaction structure
5. THE Intermezzo SHALL sign the transaction using the private key stored in HashiCorp Vault
6. THE Intermezzo SHALL return the signed transaction to Backend_Service
7. WHEN Intermezzo signing fails, THE Backend_Service SHALL return the error to Algopay_CLI without retrying
8. THE Backend_Service SHALL include session context in all Intermezzo signing requests for audit logging

### Requirement 18: MCP Runtime Orchestration

**User Story:** As a system component, I want the MCP runtime to orchestrate multiple MCP servers, so that the CLI can access all required blockchain tools.

#### Acceptance Criteria

1. WHEN the Algopay_CLI initializes, THE MCP_Runtime SHALL start the algorand-mcp server with 125+ tools
2. THE MCP_Runtime SHALL start the algorand-remote-mcp-lite server in Wallet Edition mode
3. THE MCP_Runtime SHALL configure OAuth/OIDC authentication for algorand-remote-mcp-lite
4. THE MCP_Runtime SHALL provide a unified interface for the Algopay_CLI to call tools from both servers
5. WHEN a tool call fails, THE MCP_Runtime SHALL return the error with the server name and tool name
6. THE MCP_Runtime SHALL maintain connection health checks for both servers every 60 seconds

### Requirement 19: ARC-58 Smart Wallet Deployment

**User Story:** As a new user, I want an ARC-58 smart wallet automatically deployed, so that I can benefit from fee pooling and plugin support.

#### Acceptance Criteria

1. WHEN a new user completes authentication, THE Intermezzo SHALL check if an ARC58_Wallet exists for the user
2. WHEN no ARC58_Wallet exists, THE Intermezzo SHALL deploy a new ARC58_Wallet contract to the Algorand network
3. THE ARC58_Wallet SHALL support fee pooling via Atomic_Group transactions
4. THE ARC58_Wallet SHALL support x402 and AP2 protocol plugins
5. THE ARC58_Wallet SHALL store spending limits and guardrail configuration in contract state
6. THE Intermezzo SHALL fund the new ARC58_Wallet with minimum balance for contract storage
7. WHEN deployment fails, THE Intermezzo SHALL retry up to 3 times with exponential backoff


### Requirement 20: Transaction History and Indexer Queries

**User Story:** As a user or AI agent, I want to view my transaction history, so that I can audit past payments and trades.

#### Acceptance Criteria

1. WHEN a user executes `algopay history`, THE Algopay_CLI SHALL query the Indexer via MCP_Runtime for all transactions involving the ARC58_Wallet
2. THE Algopay_CLI SHALL display transactions in reverse chronological order with timestamp, type, amount, and counterparty
3. THE Algopay_CLI SHALL support `--limit <n>` flag to retrieve the most recent n transactions
4. THE Algopay_CLI SHALL support `--type <send|receive|trade>` flag to filter by transaction type
5. WHEN `--json` flag is provided, THE Algopay_CLI SHALL output transaction history in JSON format with full transaction details
6. THE Algopay_CLI SHALL display pending transactions with a distinct indicator

### Requirement 21: Session Management and Token Storage

**User Story:** As a user, I want my authentication session to persist across CLI invocations, so that I don't need to re-authenticate for every command.

#### Acceptance Criteria

1. WHEN authentication succeeds, THE Algopay_CLI SHALL store the session token in a secure local configuration file
2. THE Algopay_CLI SHALL store the configuration file at `~/.algopay/config.json` with file permissions set to 600
3. THE Algopay_CLI SHALL include the session token in all requests to Backend_Service
4. WHEN the session token expires, THE Backend_Service SHALL return an authentication error
5. WHEN an authentication error occurs, THE Algopay_CLI SHALL prompt the user to re-authenticate
6. THE Algopay_CLI SHALL support `algopay auth logout` to clear the session token
7. THE session token SHALL have a validity period of 30 days from last use

### Requirement 22: Error Handling and User Feedback

**User Story:** As a user or AI agent, I want clear error messages, so that I can understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN an error occurs, THE Algopay_CLI SHALL display a human-readable error message
2. THE Algopay_CLI SHALL include error codes for programmatic error handling
3. WHEN a network error occurs, THE Algopay_CLI SHALL suggest checking network connectivity
4. WHEN an authentication error occurs, THE Algopay_CLI SHALL suggest re-authenticating
5. WHEN a validation error occurs, THE Algopay_CLI SHALL display which parameter is invalid and the expected format
6. THE Algopay_CLI SHALL support `--verbose` flag for detailed error logging
7. WHEN `--verbose` flag is provided, THE Algopay_CLI SHALL display full stack traces and API request/response details


### Requirement 23: Backend Service API Endpoints

**User Story:** As a system component, I want well-defined API endpoints, so that the CLI can communicate reliably with the backend.

#### Acceptance Criteria

1. THE Backend_Service SHALL expose a REST API with endpoints for authentication, transactions, and queries
2. THE Backend_Service SHALL implement rate limiting of 100 requests per minute per session token
3. THE Backend_Service SHALL validate all input parameters and return 400 Bad Request for invalid inputs
4. THE Backend_Service SHALL return 401 Unauthorized for requests with invalid or expired session tokens
5. THE Backend_Service SHALL return 429 Too Many Requests when rate limits are exceeded
6. THE Backend_Service SHALL log all API requests with timestamp, endpoint, session token, and response status
7. THE Backend_Service SHALL implement CORS headers to allow Dashboard access from Vercel domain

### Requirement 24: Vestige DEX Integration

**User Story:** As a system component, I want to integrate with Vestige DEX aggregator, so that trades execute at optimal prices.

#### Acceptance Criteria

1. WHEN the Backend_Service needs to execute a trade, THE Backend_Service SHALL query Vestige_MCP for routing
2. THE Vestige_MCP SHALL return routes from Tinyman and Humble DEXes with expected output amounts
3. THE Backend_Service SHALL select the route with the highest output amount
4. THE Vestige_MCP SHALL provide price impact percentage for each route
5. WHEN price impact exceeds 5 percent, THE Backend_Service SHALL warn the user before executing
6. THE Backend_Service SHALL include slippage tolerance of 2 percent in swap transactions
7. WHEN the actual output is less than expected minus slippage tolerance, THE Atomic_Group SHALL fail atomically

### Requirement 25: Configuration Management

**User Story:** As a user, I want to configure wallet settings, so that I can customize behavior to my needs.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL support `algopay config set <key> <value>` to set configuration values
2. THE Algopay_CLI SHALL support `algopay config get <key>` to retrieve configuration values
3. THE Algopay_CLI SHALL support `algopay config list` to display all configuration values
4. THE Algopay_CLI SHALL support configuration keys for default-network, slippage-tolerance, and auto-confirm
5. WHEN auto-confirm is enabled, THE Algopay_CLI SHALL skip confirmation prompts for transactions
6. THE Algopay_CLI SHALL validate configuration values before storing them
7. THE Algopay_CLI SHALL store configuration in `~/.algopay/config.json` alongside session token


### Requirement 26: Network Selection and Multi-Network Support

**User Story:** As a developer, I want to test on testnet before using mainnet, so that I can verify functionality without risking real funds.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL support `--network testnet` and `--network mainnet` flags on all commands
2. WHEN no network flag is provided, THE Algopay_CLI SHALL use the default-network from configuration
3. WHEN no default-network is configured, THE Algopay_CLI SHALL use testnet
4. THE Backend_Service SHALL maintain separate Intermezzo instances for testnet and mainnet
5. THE ARC58_Wallet SHALL be deployed separately on testnet and mainnet
6. THE Algopay_CLI SHALL display the current network in status output
7. WHEN switching networks, THE Algopay_CLI SHALL warn the user if the wallet address differs between networks

### Requirement 27: Transaction Confirmation and Finality

**User Story:** As a user or AI agent, I want to know when my transaction is confirmed, so that I can trust the operation completed successfully.

#### Acceptance Criteria

1. WHEN the Backend_Service submits a transaction, THE Backend_Service SHALL wait for confirmation from the Algorand network
2. THE Backend_Service SHALL poll for transaction confirmation every 1 second for up to 10 seconds
3. WHEN the transaction is confirmed, THE Backend_Service SHALL return the transaction ID and block number
4. WHEN the transaction fails, THE Backend_Service SHALL return the failure reason from the network
5. WHEN confirmation times out after 10 seconds, THE Backend_Service SHALL return a pending status with the transaction ID
6. THE Algopay_CLI SHALL support `algopay tx status <txid>` to check the status of a pending transaction
7. THE Algopay_CLI SHALL display confirmation time in seconds for completed transactions

### Requirement 28: Guardrails Enforcement

**User Story:** As a security administrator, I want guardrails enforced before signing, so that unauthorized transactions cannot be executed.

#### Acceptance Criteria

1. WHEN the Backend_Service receives a transaction request, THE Backend_Service SHALL apply all configured Guardrails before sending to Intermezzo
2. THE Backend_Service SHALL check spending limits against the current period's accumulated spending
3. THE Backend_Service SHALL check the recipient address against the KYT blocklist
4. THE Backend_Service SHALL check the transaction amount against the per-transaction maximum
5. WHEN any Guardrails check fails, THE Backend_Service SHALL reject the transaction without contacting Intermezzo
6. THE Backend_Service SHALL log all Guardrails checks with timestamp, check type, and result
7. THE Backend_Service SHALL increment the accumulated spending counter only after transaction confirmation


### Requirement 29: Dashboard Real-Time Updates

**User Story:** As a user, I want the dashboard to show real-time updates, so that I can monitor wallet activity as it happens.

#### Acceptance Criteria

1. WHEN the Dashboard is open, THE Dashboard SHALL establish a WebSocket connection to Backend_Service
2. THE Backend_Service SHALL push transaction notifications to connected Dashboard clients
3. THE Dashboard SHALL update the balance display within 5 seconds of a confirmed transaction
4. THE Dashboard SHALL display a notification banner for incoming and outgoing transactions
5. THE Dashboard SHALL update the transaction history list without requiring a page refresh
6. WHEN the WebSocket connection is lost, THE Dashboard SHALL attempt to reconnect every 10 seconds
7. THE Dashboard SHALL fall back to polling every 30 seconds if WebSocket connection fails repeatedly

### Requirement 30: Intermezzo Health Monitoring

**User Story:** As a system administrator, I want to monitor Intermezzo health, so that I can detect and respond to signing service issues.

#### Acceptance Criteria

1. THE Backend_Service SHALL check Intermezzo health every 60 seconds via health check endpoint
2. WHEN Intermezzo health check fails, THE Backend_Service SHALL log an alert and retry after 10 seconds
3. WHEN Intermezzo is unhealthy for more than 5 minutes, THE Backend_Service SHALL send an alert notification
4. THE Backend_Service SHALL expose a health endpoint that includes Intermezzo status
5. WHEN Intermezzo is unhealthy, THE Backend_Service SHALL return 503 Service Unavailable for transaction requests
6. THE Backend_Service SHALL track Intermezzo response times and log slow responses exceeding 2 seconds
7. THE Backend_Service SHALL maintain a circuit breaker that opens after 5 consecutive Intermezzo failures

### Requirement 31: Audit Logging and Compliance

**User Story:** As a compliance officer, I want comprehensive audit logs, so that I can review all wallet operations for compliance purposes.

#### Acceptance Criteria

1. THE Backend_Service SHALL log all authentication attempts with timestamp, email, and result
2. THE Backend_Service SHALL log all transaction requests with timestamp, session token, amount, recipient, and result
3. THE Backend_Service SHALL log all Guardrails checks with timestamp, check type, and result
4. THE Backend_Service SHALL log all KYT screening results with timestamp, address, and risk score
5. THE Backend_Service SHALL log all Intermezzo signing requests with timestamp, transaction hash, and result
6. THE Backend_Service SHALL store audit logs in a tamper-evident format with cryptographic signatures
7. THE Backend_Service SHALL retain audit logs for a minimum of 7 years
8. THE Backend_Service SHALL support audit log export in JSON format via authenticated API endpoint


### Requirement 32: AlgoKit Transaction Builder Integration

**User Story:** As a system component, I want to use AlgoKit for transaction building, so that I can leverage tested and optimized transaction construction.

#### Acceptance Criteria

1. THE Backend_Service SHALL use AlgoKit Python SDK for all transaction construction
2. THE Backend_Service SHALL use AlgoKit's atomic transaction composer for building Atomic_Groups
3. THE Backend_Service SHALL use AlgoKit's fee calculation utilities to determine total fees
4. THE Backend_Service SHALL use AlgoKit's transaction validation to verify transaction correctness before signing
5. WHEN AlgoKit validation fails, THE Backend_Service SHALL return the validation error to Algopay_CLI
6. THE Backend_Service SHALL use AlgoKit's suggested parameters API to get current network parameters
7. THE Backend_Service SHALL cache network parameters for 10 seconds to reduce API calls

### Requirement 33: Fee Pooling Implementation

**User Story:** As a user, I want gasless transactions, so that I can use the wallet without holding ALGO for fees.

#### Acceptance Criteria

1. WHEN the Backend_Service builds an Atomic_Group, THE Backend_Service SHALL include a fee payment transaction from the backend wallet
2. THE Backend_Service SHALL set the fee field to zero on all user transactions in the Atomic_Group
3. THE Backend_Service SHALL calculate the total fee as the sum of minimum fees for all transactions in the group
4. THE Backend_Service SHALL set the total fee on the backend wallet's fee payment transaction
5. THE Backend_Service SHALL ensure the backend wallet maintains a minimum ALGO balance of 10 ALGO for fee payments
6. WHEN the backend wallet balance falls below 10 ALGO, THE Backend_Service SHALL send an alert notification
7. THE Atomic_Group SHALL execute atomically such that either all transactions succeed or all fail

### Requirement 34: ARC-58 Plugin System

**User Story:** As a developer, I want to extend wallet functionality with plugins, so that I can add custom logic for revenue splits and escrow.

#### Acceptance Criteria

1. THE ARC58_Wallet SHALL support plugin registration via contract method calls
2. THE ARC58_Wallet SHALL invoke registered plugins before executing transactions
3. THE ARC58_Wallet SHALL support revenue split plugins that automatically distribute incoming payments
4. THE ARC58_Wallet SHALL support escrow plugins that hold funds until conditions are met
5. THE ARC58_Wallet SHALL support dynamic limit plugins that adjust spending limits based on reputation
6. WHEN a plugin execution fails, THE ARC58_Wallet SHALL revert the entire transaction
7. THE Backend_Service SHALL provide `algopay plugin install <plugin-id>` command to register plugins


### Requirement 35: AP2 Protocol Support

**User Story:** As a service provider, I want to accept payments via AP2 protocol, so that I can support multiple payment standards.

#### Acceptance Criteria

1. THE ARC58_Wallet SHALL support AP2 protocol payment transactions
2. THE Backend_Service SHALL detect AP2 payment URLs and build appropriate transactions
3. THE Algopay_CLI SHALL support `algopay ap2 pay <url>` for AP2 payments
4. THE Backend_Service SHALL include AP2 protocol metadata in transaction notes
5. WHEN an AP2 payment succeeds, THE Backend_Service SHALL return the AP2 receipt
6. THE ARC58_Wallet SHALL emit AP2 payment events for indexing
7. THE Backend_Service SHALL support AP2 payment verification via `algopay ap2 verify <txid>`

### Requirement 36: Multi-Asset Support

**User Story:** As a user, I want to hold and transact with multiple Algorand assets, so that I can use tokens beyond USDC.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL support asset IDs or asset names in send and trade commands
2. THE Backend_Service SHALL resolve asset names to asset IDs via Indexer
3. THE Backend_Service SHALL verify the wallet has opted into the asset before attempting transactions
4. WHEN the wallet has not opted into an asset, THE Backend_Service SHALL automatically include an opt-in transaction in the Atomic_Group
5. THE Algopay_CLI SHALL display all asset balances in the balance command
6. THE Backend_Service SHALL apply spending limits per asset type
7. THE Algopay_CLI SHALL support `algopay asset opt-in <asset-id>` to manually opt into assets

### Requirement 37: Transaction Simulation and Dry-Run

**User Story:** As a user or AI agent, I want to simulate transactions before executing them, so that I can verify the expected outcome.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL support `--dry-run` flag on send and trade commands
2. WHEN `--dry-run` flag is provided, THE Backend_Service SHALL build the transaction but not send it to Intermezzo
3. THE Backend_Service SHALL use Algorand's simulate endpoint to predict transaction outcome
4. THE Algopay_CLI SHALL display the simulated result including expected balance changes
5. THE Algopay_CLI SHALL display any errors or warnings from the simulation
6. WHEN simulation succeeds, THE Algopay_CLI SHALL prompt the user to execute the real transaction
7. THE Backend_Service SHALL apply all Guardrails checks during dry-run simulation


### Requirement 38: Batch Transaction Support

**User Story:** As an AI agent, I want to execute multiple transactions in a single batch, so that I can perform complex operations efficiently.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL support `algopay batch <file>` where file contains a JSON array of transaction specifications
2. THE Backend_Service SHALL build a single Atomic_Group containing all transactions in the batch
3. THE Backend_Service SHALL apply Guardrails to the total batch amount
4. WHEN any transaction in the batch fails validation, THE Backend_Service SHALL reject the entire batch
5. THE Algopay_CLI SHALL display the status of each transaction in the batch after execution
6. THE Backend_Service SHALL limit batch size to 16 transactions per Atomic_Group
7. WHEN batch size exceeds 16 transactions, THE Backend_Service SHALL split into multiple Atomic_Groups and execute sequentially

### Requirement 39: Webhook Notifications

**User Story:** As a developer, I want webhook notifications for wallet events, so that my application can react to transactions in real-time.

#### Acceptance Criteria

1. THE Backend_Service SHALL support webhook registration via `algopay webhook add <url>`
2. THE Backend_Service SHALL send POST requests to registered webhooks for transaction events
3. THE Backend_Service SHALL include transaction details, timestamp, and event type in webhook payload
4. THE Backend_Service SHALL retry failed webhook deliveries up to 3 times with exponential backoff
5. THE Backend_Service SHALL sign webhook payloads with HMAC-SHA256 for verification
6. THE Backend_Service SHALL support webhook filtering by event type via `algopay webhook add <url> --events send,receive`
7. THE Backend_Service SHALL provide `algopay webhook list` and `algopay webhook remove <id>` commands

### Requirement 40: Performance and Scalability

**User Story:** As a system architect, I want the system to handle high transaction volumes, so that it can scale to support many users.

#### Acceptance Criteria

1. THE Backend_Service SHALL handle at least 100 concurrent transaction requests
2. THE Backend_Service SHALL respond to balance queries within 500 milliseconds at the 95th percentile
3. THE Backend_Service SHALL process transaction submissions within 2 seconds at the 95th percentile
4. THE Backend_Service SHALL implement connection pooling for Intermezzo and Indexer connections
5. THE Backend_Service SHALL cache frequently accessed data with TTL of 10 seconds
6. THE Backend_Service SHALL implement horizontal scaling via stateless design
7. THE Backend_Service SHALL use Redis for session storage to support multi-instance deployment


### Requirement 41: Deployment and Infrastructure

**User Story:** As a DevOps engineer, I want clear deployment procedures, so that I can deploy and maintain the system reliably.

#### Acceptance Criteria

1. THE Backend_Service SHALL be deployable to Render, Railway, or AWS via Docker container
2. THE Intermezzo SHALL be deployable via Docker Compose with HashiCorp Vault
3. THE Backend_Service SHALL read configuration from environment variables
4. THE Backend_Service SHALL support health check endpoint at `/health` for load balancer integration
5. THE Backend_Service SHALL expose Prometheus metrics at `/metrics` for monitoring
6. THE Dashboard SHALL be deployable to Vercel via Git integration
7. THE deployment documentation SHALL include step-by-step instructions for each component

### Requirement 42: Testing and Quality Assurance

**User Story:** As a developer, I want comprehensive tests, so that I can verify system correctness and prevent regressions.

#### Acceptance Criteria

1. THE project SHALL include connection tests for Intermezzo, Indexer, and MCP servers
2. THE project SHALL include unit tests for all Backend_Service API endpoints
3. THE project SHALL include integration tests for end-to-end transaction flows
4. THE project SHALL include property-based tests for transaction building and validation
5. THE project SHALL achieve minimum 80 percent code coverage for Backend_Service
6. THE project SHALL include load tests simulating 100 concurrent users
7. THE project SHALL include testnet integration tests that execute real transactions

### Requirement 43: Documentation and Developer Experience

**User Story:** As a developer, I want comprehensive documentation, so that I can understand and extend the system.

#### Acceptance Criteria

1. THE project SHALL include README with quick start guide and architecture overview
2. THE project SHALL include API documentation for all Backend_Service endpoints
3. THE project SHALL include CLI documentation for all Algopay_CLI commands
4. THE project SHALL include deployment guide for each infrastructure component
5. THE project SHALL include plugin development guide with example plugins
6. THE project SHALL include troubleshooting guide for common issues
7. THE project SHALL include architecture diagrams showing component interactions


### Requirement 44: Security Hardening

**User Story:** As a security engineer, I want defense-in-depth security measures, so that the system is resilient against attacks.

#### Acceptance Criteria

1. THE Backend_Service SHALL implement TLS 1.3 for all external communications
2. THE Backend_Service SHALL validate and sanitize all user inputs to prevent injection attacks
3. THE Backend_Service SHALL implement CSRF protection for Dashboard API calls
4. THE Backend_Service SHALL use secure random number generation for OTP codes
5. THE Backend_Service SHALL implement rate limiting per IP address and per session token
6. THE Backend_Service SHALL log all security events including failed authentication attempts
7. THE Backend_Service SHALL implement security headers including HSTS, CSP, and X-Frame-Options
8. THE Algopay_CLI SHALL store session tokens with OS-level encryption on supported platforms

### Requirement 45: Monitoring and Observability

**User Story:** As a site reliability engineer, I want comprehensive monitoring, so that I can detect and diagnose issues quickly.

#### Acceptance Criteria

1. THE Backend_Service SHALL emit structured logs in JSON format
2. THE Backend_Service SHALL include request ID in all log entries for request tracing
3. THE Backend_Service SHALL expose Prometheus metrics for request rate, error rate, and latency
4. THE Backend_Service SHALL expose custom metrics for Intermezzo response time and success rate
5. THE Backend_Service SHALL expose custom metrics for transaction submission rate and confirmation time
6. THE Backend_Service SHALL integrate with distributed tracing systems via OpenTelemetry
7. THE Backend_Service SHALL provide dashboard templates for Grafana monitoring

### Requirement 46: Disaster Recovery and Backup

**User Story:** As a system administrator, I want backup and recovery procedures, so that I can restore service after failures.

#### Acceptance Criteria

1. THE Backend_Service SHALL document backup procedures for session storage and configuration
2. THE Intermezzo SHALL document backup procedures for HashiCorp Vault data
3. THE Backend_Service SHALL support configuration export via `algopay admin export-config`
4. THE Backend_Service SHALL support configuration import via `algopay admin import-config`
5. THE Backend_Service SHALL document recovery procedures for each component failure scenario
6. THE Backend_Service SHALL implement automatic failover for Intermezzo when using multiple instances
7. THE Backend_Service SHALL maintain runbooks for common operational procedures


### Requirement 47: VibeKit Build System Integration

**User Story:** As a developer, I want to use VibeKit for project initialization, so that I can quickly scaffold the project structure.

#### Acceptance Criteria

1. THE project SHALL be initializable via `npx vibekit init algopay`
2. THE VibeKit initialization SHALL create the CLI project structure with TypeScript configuration
3. THE VibeKit initialization SHALL configure the MCP runtime with algorand-mcp and algorand-remote-mcp-lite
4. THE VibeKit initialization SHALL generate package.json with all required dependencies
5. THE VibeKit initialization SHALL create example configuration files for development and production
6. THE VibeKit initialization SHALL generate GitHub Actions workflows for CI/CD
7. THE VibeKit initialization SHALL create Docker Compose configuration for local development

### Requirement 48: MCP Skill Interface for AI Agents

**User Story:** As an AI agent, I want to call Algopay functions as MCP skills, so that I can integrate wallet operations into my workflows.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL expose all commands as MCP skills via algorand-remote-mcp-lite
2. THE MCP skills SHALL accept parameters in JSON format matching CLI argument structure
3. THE MCP skills SHALL return results in JSON format with status and data fields
4. THE MCP skills SHALL include skill descriptions and parameter schemas for agent discovery
5. THE MCP skills SHALL handle authentication transparently using stored session tokens
6. THE MCP skills SHALL support async execution for long-running operations like transaction confirmation
7. THE MCP skills SHALL emit progress events that agents can subscribe to

### Requirement 49: GoPlausible Bazaar Integration

**User Story:** As a user, I want seamless integration with GoPlausible Bazaar, so that I can discover and pay for x402 services easily.

#### Acceptance Criteria

1. THE Algopay_CLI SHALL cache GoPlausible Bazaar service listings locally for 1 hour
2. THE Algopay_CLI SHALL support fuzzy search across service names and descriptions
3. THE Algopay_CLI SHALL display service ratings and review counts from GoPlausible Bazaar
4. THE Algopay_CLI SHALL support service categories via `algopay x402 bazaar search --category <category>`
5. THE Algopay_CLI SHALL display service pricing in USDC with conversion to other assets
6. THE Backend_Service SHALL verify x402 payment URLs against GoPlausible Bazaar registry
7. THE Backend_Service SHALL include GoPlausible facilitator fee in transaction calculations


### Requirement 50: Correctness Properties and Invariants

**User Story:** As a quality assurance engineer, I want testable correctness properties, so that I can verify system behavior across all scenarios.

#### Acceptance Criteria

1. FOR ALL valid transactions, THE Backend_Service SHALL maintain the invariant that total input amounts equal total output amounts plus fees
2. FOR ALL Atomic_Groups, THE Backend_Service SHALL maintain the invariant that either all transactions confirm or all fail
3. FOR ALL spending limit checks, THE Backend_Service SHALL maintain the invariant that accumulated spending never exceeds the configured limit
4. FOR ALL balance queries, THE Algopay_CLI SHALL maintain the invariant that displayed balance matches Indexer state within 5 seconds
5. FOR ALL authentication flows, THE Backend_Service SHALL maintain the invariant that session tokens are unique and non-reusable after logout
6. FOR ALL fee pooling transactions, THE Backend_Service SHALL maintain the invariant that user transaction fees equal zero
7. FOR ALL KYT checks, THE Backend_Service SHALL maintain the invariant that blocklisted addresses are always rejected

### Requirement 51: Round-Trip Properties for Serialization

**User Story:** As a developer, I want round-trip guarantees for data serialization, so that data integrity is preserved across system boundaries.

#### Acceptance Criteria

1. FOR ALL transaction objects, serializing to JSON then deserializing SHALL produce an equivalent transaction object
2. FOR ALL configuration objects, writing to file then reading SHALL produce an equivalent configuration object
3. FOR ALL MCP skill parameters, encoding to JSON then decoding SHALL produce equivalent parameters
4. FOR ALL webhook payloads, serializing then deserializing SHALL preserve all fields and types
5. FOR ALL session tokens, encoding then decoding SHALL produce the original token value
6. FOR ALL Atomic_Groups, encoding to msgpack then decoding SHALL produce equivalent transaction groups
7. FOR ALL API responses, JSON serialization then deserialization SHALL preserve all data fields

### Requirement 52: Idempotency Properties

**User Story:** As a system architect, I want idempotent operations, so that retries don't cause duplicate effects.

#### Acceptance Criteria

1. WHEN a balance query is executed multiple times, THE Algopay_CLI SHALL return the same result for the same blockchain state
2. WHEN a transaction with the same ID is submitted multiple times, THE Backend_Service SHALL reject duplicates
3. WHEN a webhook is registered multiple times with the same URL, THE Backend_Service SHALL maintain only one registration
4. WHEN configuration is set to the same value multiple times, THE Algopay_CLI SHALL produce the same final state
5. WHEN an OTP is verified multiple times with the same FlowId, THE Backend_Service SHALL accept only the first verification
6. WHEN a plugin is installed multiple times, THE ARC58_Wallet SHALL maintain only one instance
7. WHEN logout is called multiple times, THE Algopay_CLI SHALL produce the same logged-out state

### Requirement 53: Metamorphic Properties for Transaction Validation

**User Story:** As a test engineer, I want metamorphic properties, so that I can verify transaction behavior without knowing exact outputs.

#### Acceptance Criteria

1. FOR ALL valid transactions, THE transaction size in bytes SHALL be less than or equal to the Algorand maximum transaction size
2. FOR ALL Atomic_Groups with fee pooling, THE total fees SHALL be greater than or equal to the sum of minimum fees for all transactions
3. FOR ALL trade operations, THE output amount SHALL be less than or equal to the input amount adjusted for price and slippage
4. FOR ALL spending limit checks, THE remaining limit SHALL be less than or equal to the configured limit
5. FOR ALL batch transactions, THE total batch size SHALL be less than or equal to 16 transactions
6. FOR ALL KYT risk scores, THE score SHALL be between 0 and 100 inclusive
7. FOR ALL transaction confirmation times, THE time SHALL be less than or equal to 10 seconds or return pending status


### Requirement 54: Error Condition Testing

**User Story:** As a test engineer, I want comprehensive error condition coverage, so that the system handles all failure modes gracefully.

#### Acceptance Criteria

1. WHEN invalid email format is provided to auth login, THE Algopay_CLI SHALL return a validation error without network calls
2. WHEN expired OTP is provided to auth verify, THE Backend_Service SHALL return an expiration error
3. WHEN insufficient balance exists for a transaction, THE Backend_Service SHALL return an insufficient funds error
4. WHEN an invalid recipient address is provided, THE Algopay_CLI SHALL return an address validation error
5. WHEN Intermezzo is unavailable, THE Backend_Service SHALL return a service unavailable error
6. WHEN network connectivity is lost, THE Algopay_CLI SHALL return a network error with retry guidance
7. WHEN spending limits are exceeded, THE Backend_Service SHALL return a limit exceeded error with current usage
8. WHEN a blocklisted address is used, THE Backend_Service SHALL return a compliance error
9. WHEN session token is expired, THE Backend_Service SHALL return an authentication error
10. WHEN transaction confirmation times out, THE Backend_Service SHALL return a pending status with transaction ID

### Requirement 55: Connection Testing Requirements

**User Story:** As a developer, I want connection tests for all external services, so that I can verify integration health before implementation.

#### Acceptance Criteria

1. THE project SHALL include a connection test for Intermezzo REST API that verifies health endpoint responds
2. THE project SHALL include a connection test for Algorand Indexer that verifies query endpoint responds
3. THE project SHALL include a connection test for algorand-mcp server that verifies MCP protocol handshake
4. THE project SHALL include a connection test for algorand-remote-mcp-lite that verifies OAuth flow initiation
5. THE project SHALL include a connection test for GoPlausible Bazaar API that verifies search endpoint responds
6. THE project SHALL include a connection test for Vestige MCP that verifies routing query responds
7. THE project SHALL include a connection test for HashiCorp Vault that verifies seal status endpoint responds
8. ALL connection tests SHALL run before implementation tests in the test suite
9. ALL connection tests SHALL provide clear error messages indicating which service is unreachable
10. ALL connection tests SHALL support both testnet and mainnet configurations

### Requirement 56: Integration Test Requirements

**User Story:** As a developer, I want end-to-end integration tests, so that I can verify the complete system works together.

#### Acceptance Criteria

1. THE project SHALL include an integration test for the complete authentication flow from login to verification
2. THE project SHALL include an integration test for sending USDC that verifies balance changes on testnet
3. THE project SHALL include an integration test for token trading that verifies swap execution on testnet
4. THE project SHALL include an integration test for x402 payment that verifies service access
5. THE project SHALL include an integration test for spending limit enforcement that verifies rejection
6. THE project SHALL include an integration test for fee pooling that verifies zero user fees
7. THE project SHALL include an integration test for Atomic_Group atomicity that verifies all-or-nothing execution
8. ALL integration tests SHALL clean up test data after execution
9. ALL integration tests SHALL use dedicated test wallets with known balances
10. ALL integration tests SHALL run against testnet only to avoid mainnet costs


### Requirement 57: Property-Based Testing Requirements

**User Story:** As a quality engineer, I want property-based tests, so that I can verify system behavior across a wide range of inputs.

#### Acceptance Criteria

1. THE project SHALL include property-based tests for transaction amount validation that test arbitrary positive numbers
2. THE project SHALL include property-based tests for address validation that test arbitrary string inputs
3. THE project SHALL include property-based tests for Atomic_Group construction that test arbitrary transaction counts
4. THE project SHALL include property-based tests for spending limit calculations that test arbitrary time periods
5. THE project SHALL include property-based tests for fee calculations that test arbitrary transaction sizes
6. THE project SHALL include property-based tests for JSON serialization that test arbitrary valid objects
7. THE project SHALL include property-based tests for rate limiting that test arbitrary request patterns
8. ALL property-based tests SHALL use a property-based testing library such as Hypothesis for Python or fast-check for TypeScript
9. ALL property-based tests SHALL run at least 100 test cases per property
10. ALL property-based tests SHALL report the minimal failing example when a property violation is found

### Requirement 58: Security Testing Requirements

**User Story:** As a security engineer, I want security-focused tests, so that I can verify the system resists common attacks.

#### Acceptance Criteria

1. THE project SHALL include tests that verify private keys never appear in logs or error messages
2. THE project SHALL include tests that verify session tokens are invalidated after logout
3. THE project SHALL include tests that verify rate limiting prevents brute force attacks
4. THE project SHALL include tests that verify input sanitization prevents injection attacks
5. THE project SHALL include tests that verify CSRF protection prevents cross-site attacks
6. THE project SHALL include tests that verify TLS is enforced for all external communications
7. THE project SHALL include tests that verify spending limits cannot be bypassed
8. THE project SHALL include tests that verify KYT checks cannot be bypassed
9. THE project SHALL include tests that verify Intermezzo is the only signing path
10. THE project SHALL include tests that verify audit logs capture all security-relevant events

### Requirement 59: Performance Testing Requirements

**User Story:** As a performance engineer, I want performance tests, so that I can verify the system meets latency and throughput requirements.

#### Acceptance Criteria

1. THE project SHALL include load tests that simulate 100 concurrent users executing transactions
2. THE project SHALL include latency tests that verify balance queries respond within 500ms at p95
3. THE project SHALL include latency tests that verify transaction submissions respond within 2s at p95
4. THE project SHALL include throughput tests that verify the system handles 100 requests per minute
5. THE project SHALL include stress tests that verify graceful degradation under overload
6. THE project SHALL include tests that verify connection pooling reduces latency
7. THE project SHALL include tests that verify caching reduces Indexer query load
8. ALL performance tests SHALL report p50, p95, and p99 latency percentiles
9. ALL performance tests SHALL report error rates and timeout rates
10. ALL performance tests SHALL run against a staging environment that mirrors production


### Requirement 60: Deployment and Operations Testing

**User Story:** As a DevOps engineer, I want deployment verification tests, so that I can ensure successful deployments.

#### Acceptance Criteria

1. THE project SHALL include smoke tests that verify all services are reachable after deployment
2. THE project SHALL include health check tests that verify all health endpoints return success
3. THE project SHALL include configuration tests that verify all required environment variables are set
4. THE project SHALL include database migration tests that verify schema updates apply successfully
5. THE project SHALL include rollback tests that verify the system can revert to previous versions
6. THE project SHALL include monitoring tests that verify metrics are being collected
7. THE project SHALL include backup tests that verify backup procedures work correctly
8. THE project SHALL include disaster recovery tests that verify recovery procedures work correctly
9. ALL deployment tests SHALL run automatically in CI/CD pipeline
10. ALL deployment tests SHALL block deployment if any test fails

## Non-Functional Requirements

### NFR-1: Security

1. THE system SHALL ensure private keys never exist outside Intermezzo's HashiCorp Vault environment
2. THE system SHALL use TLS 1.3 for all network communications
3. THE system SHALL implement defense-in-depth with multiple security layers
4. THE system SHALL follow OWASP Top 10 security best practices
5. THE system SHALL undergo security audit before production deployment

### NFR-2: Reliability

1. THE system SHALL achieve 99.9 percent uptime for Backend_Service
2. THE system SHALL implement automatic retry with exponential backoff for transient failures
3. THE system SHALL implement circuit breakers to prevent cascade failures
4. THE system SHALL maintain data consistency across all components
5. THE system SHALL support graceful degradation when external services are unavailable

### NFR-3: Performance

1. THE system SHALL respond to balance queries within 500ms at p95
2. THE system SHALL process transaction submissions within 2s at p95
3. THE system SHALL support at least 100 concurrent users
4. THE system SHALL handle at least 100 requests per minute per instance
5. THE system SHALL scale horizontally to handle increased load

### NFR-4: Maintainability

1. THE system SHALL follow consistent coding standards across all components
2. THE system SHALL maintain comprehensive documentation for all APIs
3. THE system SHALL use semantic versioning for all releases
4. THE system SHALL maintain backward compatibility for CLI commands
5. THE system SHALL provide clear upgrade paths between versions

### NFR-5: Usability

1. THE Algopay_CLI SHALL provide helpful error messages with actionable guidance
2. THE Algopay_CLI SHALL support both interactive and non-interactive modes
3. THE Dashboard SHALL be responsive and work on mobile devices
4. THE system SHALL provide comprehensive examples and tutorials
5. THE system SHALL follow AWAL command conventions for familiarity

### NFR-6: Compliance

1. THE system SHALL maintain audit logs for all financial transactions
2. THE system SHALL implement KYT screening for regulatory compliance
3. THE system SHALL support data export for compliance reporting
4. THE system SHALL retain audit logs for minimum 7 years
5. THE system SHALL support jurisdiction-specific compliance requirements


## External References

The following external resources provide essential context and implementation guidance:

1. **Intermezzo (Signing Service)**: https://github.com/algorandfoundation/intermezzo
   - Algorand Foundation's custodial API built on HashiCorp Vault
   - Provides TEE-like security for key management
   - Used in production by WorldChess

2. **GoPlausible (x402 Protocol)**: https://github.com/goplausible
   - x402 payment protocol implementation
   - Bazaar API for service discovery
   - Facilitator services for payment processing

3. **algorand-remote-mcp-lite**: https://github.com/algorand-devrel/algorand-remote-mcp-lite
   - Wallet Edition with OAuth/OIDC support
   - MCP protocol implementation for Algorand
   - Provides 125+ blockchain tools

4. **Vestige MCP**: https://github.com/vestige-fi/vestige-mcp
   - DEX aggregator for Algorand
   - Optimal routing across Tinyman and Humble
   - Price feed integration

5. **Coinbase AWAL (Inspiration)**: https://docs.cdp.coinbase.com/agentic-wallet/skills/overview
   - Reference implementation for agentic wallet UX
   - Command structure and skill interface patterns
   - Best practices for AI agent integration

6. **AlgoKit Documentation**: https://developer.algorand.org/docs/get-started/algokit/
   - Transaction building utilities
   - Atomic transaction composer
   - Testing and deployment tools

7. **Algorand Developer Portal**: https://developer.algorand.org/
   - Network parameters and specifications
   - ARC standards including ARC-58
   - Indexer API documentation

## Implementation Notes

### Test-Driven Development Approach

For each component, follow this sequence:
1. Write connection tests to verify external service availability
2. Write unit tests for core logic
3. Implement the functionality
4. Write integration tests for end-to-end flows
5. Run all tests to verify correctness

### Reference Code Priority

Before implementing any component:
1. Check the external references for existing implementations
2. Review Intermezzo documentation for signing patterns
3. Review algorand-remote-mcp-lite for MCP integration patterns
4. Review AWAL documentation for UX patterns
5. Adapt patterns to Algorand-specific requirements

### Security-First Implementation

Every implementation must:
1. Route all signing through Intermezzo (never generate or store keys)
2. Validate all inputs before processing
3. Apply guardrails before sending to Intermezzo
4. Log all security-relevant events
5. Use secure defaults for all configuration

### Deployment Strategy

Deploy components in this order:
1. HashiCorp Vault + Intermezzo (foundation)
2. Backend Service (business logic)
3. MCP Runtime (integration layer)
4. CLI (user interface)
5. Dashboard (visualization)

Each component should be tested independently before integration.
