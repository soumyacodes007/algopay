export type PaymentNetwork =
  | 'stellar'
  | 'stellar-testnet'
  | 'base'
  | 'base-sepolia'
  | 'algorand'
  | 'algorand-testnet'

export interface AppConfig {
  stellarSecret?: string
  evmPrivateKey?: string
  algorandMnemonic?: string
  network: PaymentNetwork
  budget: BudgetConfig
  canPay: boolean
  canPayStellar: boolean
  canPayEvm: boolean
  canPayAlgorand: boolean
  mode: 'READ_ONLY' | 'STELLAR_ONLY' | 'EVM_ONLY' | 'ALGORAND_ONLY' | 'FULL'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
}

export interface WalletFileConfig {
  stellarSecret?: string
  evmPrivateKey?: string
  network?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
}
