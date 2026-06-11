import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  PIXA_ADMIN_SECRET: z.string().min(16),
  BASE_TREASURY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 32-byte hex key with 0x prefix'),
  BASE_USDC_CONTRACT_MAINNET: z
    .string()
    .default('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  BASE_USDC_CONTRACT_TESTNET: z
    .string()
    .default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  PORT: z.coerce.number().default(3001)
})

export type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('❌ Invalid environment variables:')
    for (const [field, errors] of Object.entries(
      result.error.flatten().fieldErrors
    )) {
      console.error(`  ${field}: ${(errors as string[]).join(', ')}`)
    }
    process.exit(1)
  }
  return result.data
}

export const env = parseEnv()

export function getUsdcContract(): `0x${string}` {
  return env.NETWORK === 'mainnet'
    ? (env.BASE_USDC_CONTRACT_MAINNET as `0x${string}`)
    : (env.BASE_USDC_CONTRACT_TESTNET as `0x${string}`)
}
