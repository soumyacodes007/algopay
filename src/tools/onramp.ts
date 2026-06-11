import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from '@modelcontextprotocol/ext-apps/server'

const require = createRequire(import.meta.url)

const ONRAMP_WIDGET_URI = 'ui://onramp/widget-v3.html'
const DEFAULT_APP_ID = 1
const DEFAULT_MODE = 'buy'
const DEFAULT_COIN_CODE = 'algo'
const DEFAULT_NETWORK = 'algo'
const DEFAULT_FIAT_AMOUNT = 100
const HOSTED_ONRAMP_BASE_URL = 'https://on-ramp-hosting.vercel.app/'

const ONRAMP_SDK_UMD = readFileSync(
  require.resolve('@onramp.money/onramp-web-sdk/dist/onramp-web-sdk.umd.js'),
  'utf8'
)

const MCP_APPS_RUNTIME = readFileSync(
  require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'),
  'utf8'
)

type OnrampMode = 'buy' | 'sell'

type OnrampWidgetPayload = {
  appId: number
  sandbox: boolean
  mode: OnrampMode
  hostedUrl: string
  walletAddress?: string
  coinCode?: string
  network?: string
  fiatAmount?: number
  coinAmount?: number
  paymentMethod?: number
  redirectUrl?: string
  phoneNumber?: string
  lang?: string
}

function resolveAmountPrefill(input: {
  fiatAmount?: number
  coinAmount?: number
}): { fiatAmount?: number; coinAmount?: number; amountLabel: string } {
  if (typeof input.coinAmount === 'number') {
    return {
      coinAmount: input.coinAmount,
      amountLabel: `${input.coinAmount} coin`
    }
  }

  const fiatAmount = input.fiatAmount ?? DEFAULT_FIAT_AMOUNT
  return {
    fiatAmount,
    amountLabel: `${fiatAmount} fiat`
  }
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

function buildHostedOnrampUrl(
  payload: Omit<OnrampWidgetPayload, 'hostedUrl'>
): string {
  const url = new URL(HOSTED_ONRAMP_BASE_URL)
  const params = url.searchParams

  params.set('mode', payload.mode)
  params.set('appId', String(payload.appId))
  params.set('sandbox', payload.sandbox ? 'true' : 'false')

  if (payload.walletAddress) params.set('walletAddress', payload.walletAddress)
  if (payload.coinCode) params.set('coinCode', payload.coinCode)
  if (payload.network) params.set('network', payload.network)
  if (typeof payload.fiatAmount === 'number')
    params.set('fiatAmount', String(payload.fiatAmount))
  if (typeof payload.coinAmount === 'number')
    params.set('coinAmount', String(payload.coinAmount))
  if (typeof payload.paymentMethod === 'number')
    params.set('paymentMethod', String(payload.paymentMethod))
  if (payload.redirectUrl) params.set('redirectUrl', payload.redirectUrl)
  if (payload.phoneNumber) params.set('phoneNumber', payload.phoneNumber)
  if (payload.lang) params.set('lang', payload.lang)

  return url.toString()
}

function buildWidgetHtml(): string {
  const runtimeSource = escapeInlineScript(MCP_APPS_RUNTIME)
  const sdkSource = escapeInlineScript(ONRAMP_SDK_UMD)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Onramp Widget</title>
    <style>
      :root {
        --surface: #ffffff;
        --ink: #0f172a;
        --muted: #64748b;
        --line: #e2e8f0;
        --buy-soft: #ecfdf5;
        --buy-mid: #d1fae5;
        --buy-strong: #10b981;
        --sell-soft: #eef2ff;
        --sell-mid: #c7d2fe;
        --sell-strong: #6366f1;
        --danger-bg: #fef2f2;
        --danger-line: #fecaca;
        --danger-ink: #dc2626;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 24px;
        font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top, rgba(16, 185, 129, 0.08), transparent 24%),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      }

      .modal {
        width: min(100%, 860px);
        background: var(--surface);
        border-radius: 32px;
        padding: 40px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.08);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 18px;
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
        font-size: 0.76rem;
        font-weight: 700;
      }

      .error {
        display: none;
        margin-bottom: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--danger-line);
        background: var(--danger-bg);
        color: var(--danger-ink);
        font-size: 0.9rem;
        line-height: 1.45;
      }

      .error.visible {
        display: block;
      }

      .desktop-hero {
        text-align: center;
        margin-bottom: 28px;
      }

      .desktop-mark {
        width: 96px;
        height: 96px;
        margin: 0 auto 18px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at 30% 30%, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.03));
        border: 1px solid rgba(16, 185, 129, 0.12);
        font-size: 2rem;
        font-weight: 800;
      }

      .desktop-title {
        margin: 0 0 10px;
        font-size: 2rem;
        line-height: 1.15;
        font-weight: 800;
      }

      .desktop-copy {
        margin: 0 auto;
        max-width: 520px;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.6;
      }

      .desktop-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        margin-bottom: 28px;
      }

      .desktop-action {
        border: 1px solid var(--line);
        background: #ffffff;
        border-radius: 24px;
        padding: 22px;
        text-align: left;
        cursor: pointer;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }

      .desktop-action:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 32px rgba(15, 23, 42, 0.07);
      }

      .desktop-action:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .desktop-action.active.buy {
        border-color: rgba(16, 185, 129, 0.45);
        box-shadow: 0 18px 42px rgba(16, 185, 129, 0.12);
      }

      .desktop-action.active.sell {
        border-color: rgba(99, 102, 241, 0.4);
        box-shadow: 0 18px 42px rgba(99, 102, 241, 0.12);
      }

      .desktop-action-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }

      .desktop-action-icon {
        width: 56px;
        height: 56px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.4rem;
        font-weight: 800;
      }

      .desktop-action.buy .desktop-action-icon {
        background: var(--buy-mid);
        color: #047857;
      }

      .desktop-action.sell .desktop-action-icon {
        background: var(--sell-mid);
        color: #4338ca;
      }

      .desktop-action-arrow {
        color: #94a3b8;
        font-size: 1.4rem;
        line-height: 1;
      }

      .desktop-action-title {
        margin: 0 0 8px;
        font-size: 1.2rem;
        font-weight: 700;
      }

      .desktop-action-copy {
        margin: 0;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.55;
      }

      .desktop-support {
        margin-bottom: 18px;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.55;
      }

      .desktop-support strong {
        color: var(--ink);
      }

      .prefill {
        margin-bottom: 18px;
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fcfdff;
      }

      .prefill-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
      }

      .prefill-card {
        min-width: 0;
      }

      .prefill-label {
        display: block;
        margin-bottom: 4px;
        color: var(--muted);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .prefill-value {
        font-size: 0.82rem;
        line-height: 1.45;
        word-break: break-word;
      }

      .browser-cta {
        width: 100%;
        border: none;
        border-radius: 18px;
        padding: 16px;
        color: white;
        font-size: 1rem;
        font-weight: 800;
        cursor: pointer;
        transition: opacity 160ms ease, transform 160ms ease;
        background: linear-gradient(90deg, #10b981, #059669);
      }

      .browser-cta:disabled {
        opacity: 0.55;
        cursor: wait;
      }

      .footer {
        margin-top: 14px;
        text-align: center;
        color: #94a3b8;
        font-size: 0.76rem;
      }

      .footer strong {
        color: #475569;
      }

      .status {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        background: #f8fafc;
        border: 1px solid var(--line);
        color: #475569;
        font-size: 0.82rem;
        line-height: 1.45;
      }

      .browser-card {
        margin-top: 18px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: #f8fafc;
        padding: 22px;
      }

      .browser-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 1rem;
      }

      .browser-card p {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.6;
      }

      .browser-link {
        display: inline-block;
        color: #047857;
        font-size: 0.82rem;
        word-break: break-all;
      }

      @media (max-width: 760px) {
        .modal {
          padding: 28px 20px;
        }

        .desktop-title {
          font-size: 1.65rem;
        }

        .desktop-actions,
        .prefill-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <section class="modal">
      <div class="header">
        <h1 id="title">PIXA x Onramp</h1>
        <div id="badge" class="badge">Waiting for tool data</div>
      </div>

      <div class="desktop-hero">
        <div class="desktop-mark">P</div>
        <h2 class="desktop-title">Move Money Seamlessly</h2>
        <p class="desktop-copy">
          Add funds to your wallet or withdraw directly to your bank account through a secure Onramp flow.
        </p>
      </div>

      <div id="sdk-error" class="error"></div>

      <div class="desktop-actions">
        <button id="buy-button" class="desktop-action buy active" type="button">
          <div class="desktop-action-head">
            <div class="desktop-action-icon">+</div>
            <div class="desktop-action-arrow">›</div>
          </div>
          <h3 class="desktop-action-title">Add Money</h3>
          <p class="desktop-action-copy">Add funds to your wallet using UPI, IMPS, or other supported methods.</p>
        </button>

        <button id="sell-button" class="desktop-action sell" type="button">
          <div class="desktop-action-head">
            <div class="desktop-action-icon">↑</div>
            <div class="desktop-action-arrow">›</div>
          </div>
          <h3 class="desktop-action-title">Withdraw Money</h3>
          <p class="desktop-action-copy">Withdraw funds from your wallet directly to your bank account.</p>
        </button>
      </div>

      <div class="prefill">
        <div class="prefill-grid">
          <div class="prefill-card">
            <span class="prefill-label">Wallet</span>
            <div id="wallet-value" class="prefill-value">Waiting for tool payload</div>
          </div>
          <div class="prefill-card">
            <span class="prefill-label">Coin</span>
            <div id="coin-value" class="prefill-value">ALGO</div>
          </div>
          <div class="prefill-card">
            <span class="prefill-label">Network</span>
            <div id="network-value" class="prefill-value">algo</div>
          </div>
          <div class="prefill-card">
            <span class="prefill-label">Amount</span>
            <div id="amount-value" class="prefill-value">100 fiat</div>
          </div>
        </div>
      </div>

      <div class="desktop-support">
        <strong id="selected-mode">Buy flow selected.</strong>
        <span id="mode-copy"> ALGO arrives in seconds. Secure, compliant, and FIU-IND registered.</span>
      </div>

      <button id="open-browser-button" class="browser-cta" type="button">Open Secure Onramp in Browser</button>

      <div class="footer">
        Powered by <strong>Onramp.money</strong>
      </div>

      <div id="status" class="status">Connecting to MCP App host...</div>
      <div class="browser-card">
        <strong>Browser launch flow</strong>
        <p>
          Claude will hand this flow off to your default browser so the secure Onramp experience can run outside the
          app sandbox.
        </p>
        <span id="hosted-url" class="browser-link">Waiting for hosted URL...</span>
      </div>
    </section>

    <script id="mcp-app-runtime" type="text/plain">${runtimeSource}</script>
    <script>${sdkSource}</script>
    <script type="module">
      const runtimeSource = document.getElementById('mcp-app-runtime')?.textContent ?? '';
      const runtimeUrl = URL.createObjectURL(new Blob([runtimeSource], { type: 'text/javascript' }));
      const { App } = await import(runtimeUrl);
      URL.revokeObjectURL(runtimeUrl);

      const DEFAULT_COIN_CODE = ${safeJson(DEFAULT_COIN_CODE)};
      const DEFAULT_NETWORK = ${safeJson(DEFAULT_NETWORK)};
      const DEFAULT_FIAT_AMOUNT = ${safeJson(DEFAULT_FIAT_AMOUNT)};

      const badgeEl = document.getElementById('badge');
      const buyButtonEl = document.getElementById('buy-button');
      const sellButtonEl = document.getElementById('sell-button');
      const openBrowserButtonEl = document.getElementById('open-browser-button');
      const selectedModeEl = document.getElementById('selected-mode');
      const modeCopyEl = document.getElementById('mode-copy');
      const walletValueEl = document.getElementById('wallet-value');
      const coinValueEl = document.getElementById('coin-value');
      const networkValueEl = document.getElementById('network-value');
      const amountValueEl = document.getElementById('amount-value');
      const hostedUrlEl = document.getElementById('hosted-url');
      const statusEl = document.getElementById('status');
      const sdkErrorEl = document.getElementById('sdk-error');

      const app = new App(
        { name: 'x402-wallet-onramp', version: '0.2.2' },
        { availableDisplayModes: ['inline', 'fullscreen'] }
      );

      let widgetConfig = null;
      let isLoading = false;
      let lastAutoOpenedUrl = null;

      function resolveWidgetAmounts(payload) {
        if (typeof payload.coinAmount === 'number') {
          return {
            coinAmount: payload.coinAmount,
            amountLabel: String(payload.coinAmount) + ' coin'
          };
        }

        const fiatAmount = payload.fiatAmount ?? DEFAULT_FIAT_AMOUNT;
        return {
          fiatAmount,
          amountLabel: String(fiatAmount) + ' fiat'
        };
      }

      function setStatus(message) {
        statusEl.textContent = message;
      }

      function setSdkError(message) {
        if (!message) {
          sdkErrorEl.textContent = '';
          sdkErrorEl.classList.remove('visible');
          return;
        }

        sdkErrorEl.textContent = message;
        sdkErrorEl.classList.add('visible');
      }

      function setLoading(nextLoading) {
        isLoading = nextLoading;
        buyButtonEl.disabled = nextLoading || !widgetConfig;
        sellButtonEl.disabled = nextLoading || !widgetConfig;
        openBrowserButtonEl.disabled = nextLoading || !widgetConfig;
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

      function applyPayload(payload) {
        const resolvedMode = payload.mode === 'sell' ? 'sell' : 'buy';
        const resolvedCoinCode = payload.coinCode || DEFAULT_COIN_CODE;
        const resolvedNetwork = payload.network || DEFAULT_NETWORK;
        const resolvedAmounts = resolveWidgetAmounts({
          fiatAmount: payload.fiatAmount,
          coinAmount: payload.coinAmount
        });

        widgetConfig = {
          appId: payload.appId,
          sandbox: payload.sandbox,
          mode: resolvedMode,
          hostedUrl: payload.hostedUrl,
          walletAddress: payload.walletAddress,
          coinCode: resolvedCoinCode,
          network: resolvedNetwork,
          fiatAmount: resolvedAmounts.fiatAmount,
          coinAmount: resolvedAmounts.coinAmount,
          paymentMethod: payload.paymentMethod,
          redirectUrl: payload.redirectUrl,
          phoneNumber: payload.phoneNumber,
          lang: payload.lang || 'en'
        };

        badgeEl.textContent = 'Sandbox ' + (widgetConfig.sandbox ? 'on' : 'off') + ' · App ' + widgetConfig.appId;
        walletValueEl.textContent = widgetConfig.walletAddress || 'Not preset';
        coinValueEl.textContent = resolvedCoinCode;
        networkValueEl.textContent = resolvedNetwork;
        amountValueEl.textContent = resolvedAmounts.amountLabel;
        hostedUrlEl.textContent = payload.hostedUrl;
        setSelectedMode(resolvedMode);

        setSdkError(null);
        setStatus('Onramp config loaded. Opening the secure browser flow...');
        setLoading(false);
      }

      function setSelectedMode(mode) {
        if (!widgetConfig) return;

        widgetConfig.mode = mode;
        const isBuy = mode === 'buy';
        buyButtonEl.classList.toggle('active', isBuy);
        sellButtonEl.classList.toggle('active', !isBuy);
        selectedModeEl.textContent = isBuy ? 'Buy flow selected.' : 'Withdraw flow selected.';
        modeCopyEl.textContent = isBuy
          ? ' ALGO arrives in seconds. Secure, compliant, and FIU-IND registered.'
          : ' Withdraw funds back to your bank account with the secure off-ramp flow.';

        if (widgetConfig?.hostedUrl) {
          const url = new URL(widgetConfig.hostedUrl);
          url.searchParams.set('mode', mode);
          widgetConfig.hostedUrl = url.toString();
          hostedUrlEl.textContent = widgetConfig.hostedUrl;
        }
      }

      async function openHostedOnramp(modeOverride, autoOpen = false) {
        if (isLoading || !widgetConfig) return;

        if (modeOverride === 'buy' || modeOverride === 'sell') {
          setSelectedMode(modeOverride);
        }

        setLoading(true);
        setSdkError(null);
        setStatus('Opening secure Onramp page in your browser...');

        try {
          const result = await app.openLink({ url: widgetConfig.hostedUrl });
          if (result?.isError) {
            throw new Error('Claude host denied opening the external Onramp page.');
          }

          lastAutoOpenedUrl = widgetConfig.hostedUrl;
          setStatus(autoOpen ? 'Opened secure Onramp page in your browser.' : 'Browser flow opened successfully.');
          await syncHostContext('Onramp browser flow opened.', {
            onramp: {
              status: 'browser_opened',
              payload: widgetConfig
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[ONRAMP] Browser handoff failed:', error);
          setSdkError(message || 'Failed to load Onramp widget');
          setStatus('Browser handoff failed. Use the button to try again.');
        } finally {
          setLoading(false);
        }
      }

      app.ontoolresult = params => {
        const payload = params?.structuredContent?.payload;

        if (!payload || typeof payload !== 'object') {
          setSdkError('Tool launched without structuredContent.payload');
          setStatus('Tool result was missing the Onramp payload.');
          return;
        }

        applyPayload(payload);
        if (payload.hostedUrl && payload.hostedUrl !== lastAutoOpenedUrl) {
          void openHostedOnramp(payload.mode === 'sell' ? 'sell' : 'buy', true);
        }
      };

      app.onteardown = async () => ({});

      buyButtonEl.addEventListener('click', () => openHostedOnramp('buy'));
      sellButtonEl.addEventListener('click', () => openHostedOnramp('sell'));
      openBrowserButtonEl.addEventListener('click', () => openHostedOnramp(widgetConfig?.mode || 'buy'));
      setLoading(false);

      try {
        setStatus('Connecting to MCP App host...');
        await app.connect();
        setStatus('Connected. Waiting for tool result payload...');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[MCP APP] Error:', error);
        setSdkError(message || 'Failed to connect to the MCP App host');
        setStatus('MCP App host connection failed.');
      }
    </script>
  </body>
</html>`
}

export function registerOnrampTool(server: McpServer): void {
  registerAppResource(
    server,
    'Onramp checkout widget',
    ONRAMP_WIDGET_URI,
    {
      description: 'Onramp.money buy or sell launcher for MCP App clients.',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: ['https://api.onramp.money'],
            resourceDomains: [HOSTED_ONRAMP_BASE_URL]
          }
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: ONRAMP_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildWidgetHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: ['https://api.onramp.money'],
                resourceDomains: [HOSTED_ONRAMP_BASE_URL]
              }
            }
          }
        }
      ]
    })
  )

  registerAppTool(
    server,
    'open_onramp',
    {
      title: 'Open Onramp Widget',
      description:
        'Launch an interactive Onramp.money buy or sell flow inside the conversation using an MCP App resource. ' +
        'Defaults to sandbox appId 1 and the same modal-style launch flow as the working frontend component.',
      inputSchema: {
        mode: z
          .enum(['buy', 'sell'])
          .optional()
          .default(DEFAULT_MODE)
          .describe('Whether to open the buy or sell flow.'),
        app_id: z
          .number()
          .int()
          .positive()
          .optional()
          .default(DEFAULT_APP_ID)
          .describe('Onramp application ID. Use 1 for sandbox testing.'),
        sandbox: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to use Onramp sandbox mode.'),
        wallet_address: z
          .string()
          .optional()
          .describe('Destination wallet address to prefill in the widget.'),
        coin_code: z
          .string()
          .optional()
          .default(DEFAULT_COIN_CODE)
          .describe('Crypto code to prefill. Defaults to ALGO.'),
        network: z
          .string()
          .optional()
          .default(DEFAULT_NETWORK)
          .describe('Onramp network name. Defaults to algo for Algorand.'),
        fiat_amount: z
          .number()
          .positive()
          .optional()
          .default(DEFAULT_FIAT_AMOUNT)
          .describe('Fiat amount to prefill. Defaults to 100.'),
        coin_amount: z
          .number()
          .positive()
          .optional()
          .describe('Optional coin amount to prefill.'),
        payment_method: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe('Optional payment method: 1 for UPI, 2 for bank transfer.'),
        redirect_url: z
          .string()
          .url()
          .optional()
          .describe('Optional redirect URL after the widget flow completes.'),
        phone_number: z
          .string()
          .optional()
          .describe(
            'Optional URL-encoded phone number, like %2B91-9999999999.'
          ),
        lang: z
          .string()
          .optional()
          .default('en')
          .describe('Language code to prefill. Defaults to en.')
      },
      _meta: {
        ui: {
          resourceUri: ONRAMP_WIDGET_URI
        }
      }
    },
    async ({
      mode,
      app_id,
      sandbox,
      wallet_address,
      coin_code,
      network,
      fiat_amount,
      coin_amount,
      payment_method,
      redirect_url,
      phone_number,
      lang
    }) => {
      if (typeof fiat_amount === 'number' && typeof coin_amount === 'number') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'open_onramp error: provide either fiat_amount or coin_amount, not both.'
            }
          ],
          isError: true
        }
      }

      const resolvedAmounts = resolveAmountPrefill({
        fiatAmount: fiat_amount,
        coinAmount: coin_amount
      })

      const payloadWithoutHostedUrl = {
        appId: app_id,
        sandbox,
        mode,
        walletAddress: wallet_address,
        coinCode: coin_code,
        network,
        fiatAmount: resolvedAmounts.fiatAmount,
        coinAmount: resolvedAmounts.coinAmount,
        paymentMethod: payment_method,
        redirectUrl: redirect_url,
        phoneNumber: phone_number,
        lang
      }

      const payload: OnrampWidgetPayload = {
        ...payloadWithoutHostedUrl,
        hostedUrl: buildHostedOnrampUrl(payloadWithoutHostedUrl)
      }

      const lines = [
        'External Onramp browser flow ready.',
        `Mode: ${payload.mode}`,
        `Sandbox: ${payload.sandbox ? 'true' : 'false'}`,
        `App ID: ${payload.appId}`,
        `Wallet prefill: ${payload.walletAddress ?? 'none'}`,
        `Coin prefill: ${payload.coinCode ?? DEFAULT_COIN_CODE}`,
        `Network prefill: ${payload.network ?? DEFAULT_NETWORK}`,
        `Amount prefill: ${resolvedAmounts.amountLabel}`,
        `Hosted URL: ${payload.hostedUrl}`
      ]

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n')
          }
        ],
        structuredContent: {
          payload
        }
      }
    }
  )
}

export { DEFAULT_APP_ID, ONRAMP_WIDGET_URI, buildWidgetHtml }
