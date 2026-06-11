import type { PaymentNetwork, AppConfig } from '@/types.js'
import { loadWalletConfig } from '@/wallet-store.js'

export function loadConfig(): AppConfig {
  const state = buildState()
  return {
    ...state,
    reload() {
      const fresh = buildState()
      Object.assign(this, fresh)
    }
  }
}

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  const stellarSecret =
    process.env.STELLAR_SECRET ?? wallet?.stellarSecret ?? undefined
  const evmPrivateKey =
    process.env.EVM_PRIVATE_KEY ?? wallet?.evmPrivateKey ?? undefined
  const algorandMnemonic =
    process.env.ALGORAND_MNEMONIC ?? wallet?.algorandMnemonic ?? undefined
  const network = (process.env.NETWORK ??
    wallet?.network ??
    'algorand-testnet') as PaymentNetwork

  const maxPerCall = process.env.MAX_PER_CALL ?? '0.10'
  const maxPerDay = process.env.MAX_PER_DAY ?? '20.00'

  const canPayStellar = !!stellarSecret
  const canPayEvm = !!evmPrivateKey
  const canPayAlgorand = !!algorandMnemonic
  const canPay = canPayStellar || canPayEvm || canPayAlgorand

  let mode: AppConfig['mode'] = 'READ_ONLY'
  if (canPayStellar && canPayEvm && canPayAlgorand) mode = 'FULL'
  else if (canPayStellar && canPayEvm) mode = 'FULL'
  else if (canPayStellar && canPayAlgorand) mode = 'FULL'
  else if (canPayEvm && canPayAlgorand) mode = 'FULL'
  else if (canPayStellar) mode = 'STELLAR_ONLY'
  else if (canPayEvm) mode = 'EVM_ONLY'
  else if (canPayAlgorand) mode = 'ALGORAND_ONLY'

  return {
    stellarSecret,
    evmPrivateKey,
    algorandMnemonic,
    network,
    budget: { maxPerCall, maxPerDay },
    canPay,
    canPayStellar,
    canPayEvm,
    canPayAlgorand,
    mode
  }
}
