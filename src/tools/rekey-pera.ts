import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import algosdk from 'algosdk'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from '@modelcontextprotocol/ext-apps/server'

const require = createRequire(import.meta.url)

const MCP_APPS_RUNTIME = readFileSync(
  require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'),
  'utf8'
)

const REKEY_WIDGET_URI = 'ui://pera-rekey/widget-v1.html'
const PERA_CONNECT_MODULE_URL =
  'https://esm.sh/@perawallet/connect@1.5.2?bundle'
const ALGOSDK_MODULE_URL = 'https://esm.sh/algosdk@3.5.2?bundle'

const ALGOD_URLS: Record<'algorand' | 'algorand-testnet', string> = {
  algorand: 'https://mainnet-api.algonode.cloud',
  'algorand-testnet': 'https://testnet-api.algonode.cloud'
}

const EXPLORER_BASE_URLS: Record<'algorand' | 'algorand-testnet', string> = {
  algorand: 'https://explorer.perawallet.app/tx/',
  'algorand-testnet': 'https://testnet.explorer.perawallet.app/tx/'
}

const PERA_CONNECT_DOMAINS = [
  'https://esm.sh',
  'https://wc.perawallet.app',
  'https://bridge.walletconnect.org',
  'https://perawallet.app',
  'https://s3.amazonaws.com',
  'https://mainnet-api.algonode.cloud',
  'https://testnet-api.algonode.cloud',
  'https://node-mainnet.chain.perawallet.app',
  'https://node-testnet.chain.perawallet.app',
  'https://indexer-mainnet.chain.perawallet.app',
  'https://indexer-testnet.chain.perawallet.app'
]

type RekeyPayload = {
  sourceAddress: string
  newAuthAddress: string
  network: 'algorand' | 'algorand-testnet'
  algodUrl: string
  explorerBaseUrl: string
  unsignedTxnBase64: string
  note?: string
  feeMicroAlgos: number
  validRoundFirst: number
  validRoundLast: number
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeInlineScript(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script')
}

function buildRekeyHtml(): string {
  const runtimeSource = escapeInlineScript(MCP_APPS_RUNTIME)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PIXA Pera Rekey</title>
    <style>
      :root {
        --bg: #f8fafc;
        --surface: #ffffff;
        --ink: #0f172a;
        --muted: #64748b;
        --line: #e2e8f0;
        --success: #059669;
        --success-soft: #ecfdf5;
        --danger: #dc2626;
        --danger-soft: #fef2f2;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        padding: 36px 20px;
        font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        color: var(--ink);
      }

      .shell {
        width: min(100%, 860px);
        margin: 0 auto;
        background: var(--surface);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 28px;
        padding: 32px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
      }

      .header h1 {
        margin: 0;
        font-size: 1rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #f8fafc;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 700;
      }

      .hero {
        margin-bottom: 24px;
      }

      .hero h2 {
        margin: 0 0 10px;
        font-size: 1.9rem;
        line-height: 1.15;
      }

      .hero p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .error, .success, .status {
        border-radius: 16px;
        padding: 12px 14px;
        font-size: 0.9rem;
        line-height: 1.5;
      }

      .error {
        display: none;
        margin-bottom: 16px;
        background: var(--danger-soft);
        border: 1px solid #fecaca;
        color: var(--danger);
      }

      .error.visible {
        display: block;
      }

      .success {
        display: none;
        margin-top: 16px;
        background: var(--success-soft);
        border: 1px solid #a7f3d0;
        color: var(--success);
      }

      .success.visible {
        display: block;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 20px;
      }

      .card {
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fcfdff;
      }

      .label {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .value {
        font-size: 0.9rem;
        line-height: 1.5;
        word-break: break-word;
      }

      .actions {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }

      button {
        border: none;
        border-radius: 16px;
        padding: 14px 18px;
        font-size: 0.95rem;
        font-weight: 800;
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.55;
        cursor: wait;
      }

      .primary {
        background: linear-gradient(90deg, #111827, #334155);
        color: white;
      }

      .secondary {
        background: #f8fafc;
        color: #0f172a;
        border: 1px solid var(--line);
      }

      .status {
        background: #f8fafc;
        border: 1px solid var(--line);
        color: #475569;
      }

      .footnote {
        margin-top: 16px;
        color: var(--muted);
        font-size: 0.84rem;
        line-height: 1.6;
      }

      .footnote a {
        color: #0f172a;
      }

      @media (max-width: 760px) {
        .shell { padding: 24px 18px; }
        .summary { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <section class="shell">
      <div class="header">
        <h1>PIXA Rekey</h1>
        <div id="network-badge" class="badge">Waiting for tool data</div>
      </div>

      <div class="hero">
        <h2>Approve a Rekey Request with Pera</h2>
        <p>
          Connect your Pera wallet, verify that the connected account matches the requested wallet address,
          and approve the rekey transaction. PIXA will then broadcast it to Algorand.
        </p>
      </div>

      <div id="error" class="error"></div>

      <div class="summary">
        <div class="card">
          <span class="label">Wallet to Rekey</span>
          <div id="source-address" class="value">Waiting for payload...</div>
        </div>
        <div class="card">
          <span class="label">New Authorized Address</span>
          <div id="target-address" class="value">Waiting for payload...</div>
        </div>
        <div class="card">
          <span class="label">Connected Pera Account</span>
          <div id="connected-address" class="value">Not connected</div>
        </div>
        <div class="card">
          <span class="label">Transaction Window</span>
          <div id="round-window" class="value">Waiting for payload...</div>
        </div>
      </div>

      <div class="actions">
        <button id="connect-button" class="primary" type="button">Connect Pera Wallet</button>
        <button id="approve-button" class="secondary" type="button" disabled>Approve Rekey Request</button>
      </div>

      <div id="status" class="status">Connecting to MCP App host...</div>
      <div id="success" class="success"></div>

      <div class="footnote">
        If Pera opens on another device, approve the signing request there. If the wrong account is connected,
        disconnect in Pera and reconnect with the requested address.
      </div>
    </section>

    <script id="mcp-app-runtime" type="text/plain">${runtimeSource}</script>
    <script type="module">
      const runtimeSource = document.getElementById('mcp-app-runtime')?.textContent ?? '';
      const runtimeUrl = URL.createObjectURL(new Blob([runtimeSource], { type: 'text/javascript' }));
      const { App } = await import(runtimeUrl);
      URL.revokeObjectURL(runtimeUrl);

      const [{ default: PeraWalletConnect }, { default: algosdk }] = await Promise.all([
        import(${safeJson(PERA_CONNECT_MODULE_URL)}),
        import(${safeJson(ALGOSDK_MODULE_URL)})
      ]);

      const app = new App(
        { name: 'x402-wallet-pera-rekey', version: '0.2.3' },
        { availableDisplayModes: ['inline', 'fullscreen'] }
      );

      const connectButtonEl = document.getElementById('connect-button');
      const approveButtonEl = document.getElementById('approve-button');
      const networkBadgeEl = document.getElementById('network-badge');
      const sourceAddressEl = document.getElementById('source-address');
      const targetAddressEl = document.getElementById('target-address');
      const connectedAddressEl = document.getElementById('connected-address');
      const roundWindowEl = document.getElementById('round-window');
      const statusEl = document.getElementById('status');
      const errorEl = document.getElementById('error');
      const successEl = document.getElementById('success');

      const CHAIN_IDS = {
        algorand: 416001,
        'algorand-testnet': 416002
      };

      const peraWallet = new PeraWalletConnect({
        chainId: CHAIN_IDS['algorand-testnet'],
        compactMode: true,
        shouldShowSignTxnToast: true
      });

      let payload = null;
      let connectedAddress = null;
      let isBusy = false;

      function setBusy(nextBusy) {
        isBusy = nextBusy;
        connectButtonEl.disabled = nextBusy || !payload;
        approveButtonEl.disabled = nextBusy || !payload || connectedAddress !== payload.sourceAddress;
      }

      function setStatus(message) {
        statusEl.textContent = message;
      }

      function setError(message) {
        if (!message) {
          errorEl.textContent = '';
          errorEl.classList.remove('visible');
          return;
        }

        errorEl.textContent = message;
        errorEl.classList.add('visible');
      }

      function setSuccess(message) {
        if (!message) {
          successEl.textContent = '';
          successEl.classList.remove('visible');
          return;
        }

        successEl.textContent = message;
        successEl.classList.add('visible');
      }

      async function syncHostContext(message, structuredContent) {
        try {
          await app.updateModelContext({
            content: [{ type: 'text', text: message }],
            structuredContent
          });
        } catch (error) {
          console.warn('updateModelContext failed', error);
        }
      }

      function applyPayload(nextPayload) {
        payload = nextPayload;
        peraWallet.chainId = CHAIN_IDS[payload.network];
        networkBadgeEl.textContent = payload.network + ' rekey request';
        sourceAddressEl.textContent = payload.sourceAddress;
        targetAddressEl.textContent = payload.newAuthAddress;
        roundWindowEl.textContent =
          'Rounds ' + payload.validRoundFirst + ' - ' + payload.validRoundLast + ' | Fee ' + payload.feeMicroAlgos + ' microALGO';
        connectedAddressEl.textContent = connectedAddress || 'Not connected';
        setError(null);
        setSuccess(null);
        setStatus('Payload ready. Connect the matching Pera account to continue.');
        setBusy(false);
      }

      function setConnectedAddress(address) {
        connectedAddress = address || null;
        connectedAddressEl.textContent = connectedAddress || 'Not connected';

        if (payload && connectedAddress && connectedAddress !== payload.sourceAddress) {
          setError(
            'Connected Pera account mismatch. Expected ' +
              payload.sourceAddress +
              ' but got ' +
              connectedAddress +
              '. Disconnect in Pera and reconnect with the requested wallet.'
          );
        } else if (payload && connectedAddress === payload.sourceAddress) {
          setError(null);
          setStatus('Correct Pera account connected. You can now approve the rekey request.');
        }

        setBusy(false);
      }

      async function connectPeraWallet() {
        if (!payload || isBusy) return;

        setBusy(true);
        setError(null);
        setSuccess(null);
        setStatus('Opening Pera connection flow...');

        try {
          const accounts = await peraWallet.connect({ selectedAccount: payload.sourceAddress });
          const selected = accounts?.[0] || null;
          setConnectedAddress(selected);
        } catch (error) {
          const message = error?.message || String(error);
          setError(message || 'Pera connection failed.');
          setStatus('Pera connection failed.');
          setBusy(false);
        }
      }

      async function reconnectPeraWallet() {
        try {
          const accounts = await peraWallet.reconnectSession();
          const selected = accounts?.[0] || null;
          if (selected) {
            setConnectedAddress(selected);
          }
        } catch (error) {
          console.warn('Pera reconnect failed', error);
        }
      }

      async function approveRekey() {
        if (!payload || isBusy) return;
        if (!connectedAddress) {
          setError('Connect Pera first.');
          return;
        }
        if (connectedAddress !== payload.sourceAddress) {
          setError('Connected account does not match the wallet that must be rekeyed.');
          return;
        }

        setBusy(true);
        setError(null);
        setSuccess(null);
        setStatus('Requesting signature from Pera...');

        try {
          const txnBytes = Uint8Array.from(atob(payload.unsignedTxnBase64), char => char.charCodeAt(0));
          const txn = algosdk.decodeUnsignedTransaction(txnBytes);
          const signedTxns = await peraWallet.signTransaction([
            [
              {
                txn,
                signers: [payload.sourceAddress],
                message: 'Approve PIXA rekey request'
              }
            ]
          ]);

          const signedBlob = signedTxns[0];
          const algodClient = new algosdk.Algodv2('', payload.algodUrl, '');
          const sendResult = await algodClient.sendRawTransaction(signedBlob).do();
          const txid = sendResult.txid || sendResult.txId;
          const confirmation = await algosdk.waitForConfirmation(algodClient, txid, 4);
          const explorerUrl = payload.explorerBaseUrl + txid;

          const successMessage =
            'Rekey transaction confirmed. TxID: ' + txid + '. View on explorer: ' + explorerUrl;

          setSuccess(successMessage);
          setStatus('Rekey confirmed onchain.');
          await syncHostContext('PIXA rekey request approved and confirmed.', {
            rekey: {
              status: 'confirmed',
              txid,
              explorerUrl,
              sourceAddress: payload.sourceAddress,
              newAuthAddress: payload.newAuthAddress,
              network: payload.network,
              confirmedRound: Number(confirmation.confirmedRound ?? 0)
            }
          });
        } catch (error) {
          const message = error?.message || String(error);
          setError(message || 'Pera signing failed.');
          setStatus('Rekey request failed.');
        } finally {
          setBusy(false);
        }
      }

      app.ontoolresult = params => {
        const nextPayload = params?.structuredContent?.payload;

        if (!nextPayload || typeof nextPayload !== 'object') {
          setError('Tool launched without structuredContent.payload');
          setStatus('Tool result was missing the rekey payload.');
          return;
        }

        applyPayload(nextPayload);
      };

      app.onteardown = async () => ({});

      connectButtonEl.addEventListener('click', connectPeraWallet);
      approveButtonEl.addEventListener('click', approveRekey);
      setBusy(false);

      try {
        setStatus('Connecting to MCP App host...');
        await app.connect();
        setStatus('Connected. Waiting for rekey payload...');
        await reconnectPeraWallet();
      } catch (error) {
        const message = error?.message || String(error);
        setError(message || 'Failed to connect to the MCP App host.');
        setStatus('MCP App host connection failed.');
      }
    </script>
  </body>
</html>`
}

export function registerPeraRekeyTool(server: McpServer): void {
  registerAppResource(
    server,
    'Pera rekey approval widget',
    REKEY_WIDGET_URI,
    {
      description:
        'Connect Pera Wallet, approve a rekey transaction, and broadcast it to Algorand.',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: PERA_CONNECT_DOMAINS,
            resourceDomains: PERA_CONNECT_DOMAINS
          }
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: REKEY_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildRekeyHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: PERA_CONNECT_DOMAINS,
                resourceDomains: PERA_CONNECT_DOMAINS
              }
            }
          }
        }
      ]
    })
  )

  registerAppTool(
    server,
    'rekey_with_pera',
    {
      title: 'Request Rekey via Pera Wallet',
      description:
        'Create an Algorand rekey transaction and ask the user to approve it in Pera Wallet through an MCP App.',
      inputSchema: {
        wallet_address: z
          .string()
          .describe(
            'The Algorand address currently controlled by the user in Pera Wallet.'
          ),
        new_auth_address: z
          .string()
          .describe(
            'The new authorized Algorand address that should control the wallet after rekeying.'
          ),
        network: z
          .enum(['algorand', 'algorand-testnet'])
          .default('algorand-testnet')
          .describe('Algorand network for the rekey transaction.'),
        note: z
          .string()
          .optional()
          .describe('Optional note to include in the rekey transaction.')
      },
      _meta: {
        ui: {
          resourceUri: REKEY_WIDGET_URI
        }
      }
    },
    async ({ wallet_address, new_auth_address, network, note }) => {
      if (!algosdk.isValidAddress(wallet_address)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid wallet_address. Expected a valid Algorand address.'
            }
          ],
          isError: true
        }
      }

      if (!algosdk.isValidAddress(new_auth_address)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid new_auth_address. Expected a valid Algorand address.'
            }
          ],
          isError: true
        }
      }

      try {
        const algodUrl = ALGOD_URLS[network]
        const algodClient = new algosdk.Algodv2('', algodUrl, '')
        const suggestedParams = await algodClient.getTransactionParams().do()
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: wallet_address,
          receiver: wallet_address,
          amount: 0,
          rekeyTo: new_auth_address,
          suggestedParams,
          note: note ? new TextEncoder().encode(note) : undefined
        })

        const unsignedTxnBase64 = Buffer.from(
          algosdk.encodeUnsignedTransaction(txn)
        ).toString('base64')
        const payload: RekeyPayload = {
          sourceAddress: wallet_address,
          newAuthAddress: new_auth_address,
          network,
          algodUrl,
          explorerBaseUrl: EXPLORER_BASE_URLS[network],
          unsignedTxnBase64,
          note,
          feeMicroAlgos: Number(txn.fee),
          validRoundFirst: Number(txn.firstValid),
          validRoundLast: Number(txn.lastValid)
        }

        const lines = [
          'Pera rekey approval request ready.',
          `Source wallet: ${payload.sourceAddress}`,
          `New auth address: ${payload.newAuthAddress}`,
          `Network: ${payload.network}`,
          `Valid rounds: ${payload.validRoundFirst} - ${payload.validRoundLast}`,
          `Fee: ${payload.feeMicroAlgos} microALGO`
        ]

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: {
            payload
          }
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to prepare rekey transaction: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
