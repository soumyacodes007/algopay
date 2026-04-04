import type { PaymentNetwork, AppConfig } from '@/types.js'

const CAIP2_NETWORKS: Record<PaymentNetwork, string> = {
  stellar: 'stellar:pubnet',
  'stellar-testnet': 'stellar:testnet',
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  algorand: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  'algorand-testnet': 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
}

export function isStellarNetwork(network: PaymentNetwork): boolean {
  return network === 'stellar' || network === 'stellar-testnet'
}

export function isEvmNetwork(network: PaymentNetwork): boolean {
  return network === 'base' || network === 'base-sepolia'
}

export function isAlgorandNetwork(network: PaymentNetwork): boolean {
  return network === 'algorand' || network === 'algorand-testnet'
}

export function getCaip2Network(network: PaymentNetwork): string {
  return CAIP2_NETWORKS[network]
}

// ─── Algorand Signer (from 25-word mnemonic) ─────────────────────────────────
// Uses algosdk.mnemonicToSecretKey to derive the secret key from the mnemonic.
// The ClientAvmSigner interface only needs address + signTransactions.
async function createAlgorandSigner(mnemonic: string) {
  const algosdk = await import('algosdk')
  const { sk, addr } = algosdk.default.mnemonicToSecretKey(mnemonic)
  // addr is an Address object — encode to string for the ClientAvmSigner interface
  const address = algosdk.default.encodeAddress(addr.publicKey)
  return {
    address,
    signTransactions: async (
      txns: Uint8Array[],
      indexesToSign?: number[]
    ): Promise<(Uint8Array | null)[]> => {
      return txns.map((txnBytes, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null
        const decoded = algosdk.default.decodeUnsignedTransaction(txnBytes)
        const signed = algosdk.default.signTransaction(decoded, sk)
        return signed.blob
      })
    }
  }
}

// Note: We return `any` because the AVM specific x402HTTPClient has a slightly 
// different typing strictness than the generic @x402/core/client one.
export async function createHttpClient(
  network: PaymentNetwork,
  config: AppConfig
): Promise<any> {
  // ─── ALGORAND uses the @x402-avm pipeline for fee-payer logic ────────────────
  if (isAlgorandNetwork(network) && config.algorandMnemonic) {
    const { x402Client, x402HTTPClient } = await import('@x402-avm/core/client')
    const { registerExactAvmScheme } = await import('@x402-avm/avm/exact/client')
    const client = new x402Client()
    const signer = await createAlgorandSigner(config.algorandMnemonic)
    
    registerExactAvmScheme(client, {
      signer,
      algodConfig: {
        algodUrl:
          network === 'algorand-testnet'
            ? 'https://testnet-api.algonode.cloud'
            : 'https://mainnet-api.algonode.cloud'
      }
    })
    return new x402HTTPClient(client)
  }

  // ─── EVM / STELLAR uses the generic @x402/core pipeline ──────────────────────
  const { x402Client, x402HTTPClient } = await import('@x402/core/client')
  const client = new x402Client()

  if (isStellarNetwork(network) && config.stellarSecret) {
    const { ExactStellarScheme, createEd25519Signer } =
      await import('@x402/stellar')
    const signer = createEd25519Signer(config.stellarSecret)
    const caip2 = getCaip2Network(network) as `${string}:${string}`
    const scheme = new ExactStellarScheme(signer)
    client.register(caip2, scheme)
  }

  if (isEvmNetwork(network) && config.evmPrivateKey) {
    const { registerExactEvmScheme } = await import('@x402/evm/exact/client')
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createWalletClient, http, publicActions } = await import('viem')
    const { baseSepolia, base } = await import('viem/chains')

    const chain = network === 'base-sepolia' ? baseSepolia : base
    const account = privateKeyToAccount(config.evmPrivateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http()
    }).extend(publicActions)

    const signer = Object.assign(walletClient, { address: account.address })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerExactEvmScheme(client, { signer: signer as any })
  }

  return new x402HTTPClient(client)
}

export async function getWalletAddress(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (isStellarNetwork(network) && config.stellarSecret) {
    const { createEd25519Signer } = await import('@x402/stellar')
    const signer = createEd25519Signer(config.stellarSecret)
    return signer.address
  }

  if (isEvmNetwork(network) && config.evmPrivateKey) {
    const { privateKeyToAccount } = await import('viem/accounts')
    const account = privateKeyToAccount(config.evmPrivateKey as `0x${string}`)
    return account.address
  }

  if (isAlgorandNetwork(network) && config.algorandMnemonic) {
    const algosdk = await import('algosdk')
    const { addr } = algosdk.default.mnemonicToSecretKey(config.algorandMnemonic)
    return algosdk.default.encodeAddress(addr.publicKey)
  }

  throw new Error(`No key configured for network ${network}`)
}

// USDC ASA IDs for Algorand networks
const USDC_ASA: Record<string, number> = {
  'algorand-testnet': 10458941,    // USDC on Algorand Testnet
  algorand: 31566704               // USDC on Algorand Mainnet
}

export async function getUsdcBalance(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (isStellarNetwork(network) && config.stellarSecret) {
    const { createEd25519Signer, getHorizonClient } =
      await import('@x402/stellar')
    const signer = createEd25519Signer(config.stellarSecret)
    const caip2 = getCaip2Network(network) as `${string}:${string}`
    const horizon = getHorizonClient(caip2)

    try {
      const account = await horizon.loadAccount(signer.address)
      for (const bal of account.balances) {
        if ('asset_code' in bal && bal.asset_code === 'USDC') {
          return bal.balance
        }
      }
      return '0.0000000'
    } catch {
      return '0.0000000'
    }
  }

  if (isEvmNetwork(network) && config.evmPrivateKey) {
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createPublicClient, http, erc20Abi } = await import('viem')
    const { baseSepolia, base } = await import('viem/chains')

    const chain = network === 'base-sepolia' ? baseSepolia : base
    const account = privateKeyToAccount(config.evmPrivateKey as `0x${string}`)
    const publicClient = createPublicClient({ chain, transport: http() })

    const USDC_ADDRESSES: Record<string, `0x${string}`> = {
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    }

    const usdcAddress = USDC_ADDRESSES[network]
    if (!usdcAddress) return '0.000000'

    try {
      const balance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address]
      })
      const decimals = 6
      const raw = BigInt(balance as bigint)
      const whole = raw / BigInt(10 ** decimals)
      const frac = raw % BigInt(10 ** decimals)
      return `${whole}.${frac.toString().padStart(decimals, '0')}`
    } catch {
      return '0.000000'
    }
  }

  if (isAlgorandNetwork(network) && config.algorandMnemonic) {
    try {
      const algosdk = await import('algosdk')
      const { addr } = algosdk.default.mnemonicToSecretKey(config.algorandMnemonic)
      const algodUrl =
        network === 'algorand-testnet'
          ? 'https://testnet-api.algonode.cloud'
          : 'https://mainnet-api.algonode.cloud'
      const algodClient = new algosdk.default.Algodv2('', algodUrl, '')
      const accountInfo = await algodClient.accountInformation(addr).do()

      // Find USDC ASA in assets — use any cast because algosdk AssetHolding
      // uses a different field name depending on SDK version
      const assetId = USDC_ASA[network]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usdcAsset = (accountInfo.assets as any[])?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => Number(a.assetId ?? a['asset-id']) === assetId
      )
      if (!usdcAsset) return '0.000000 (not opted-in to USDC)'

      const raw = BigInt(usdcAsset.amount ?? 0)
      const decimals = 6
      const whole = raw / BigInt(10 ** decimals)
      const frac = raw % BigInt(10 ** decimals)
      return `${whole}.${frac.toString().padStart(decimals, '0')}`
    } catch {
      return '0.000000'
    }
  }

  throw new Error(`No key configured for network ${network}`)
}
