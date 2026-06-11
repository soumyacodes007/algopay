import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core'

// ─── users ───────────────────────────────────────────────────────────────────
// One row per Algorand address. Identity anchor for all balance and ledger tables.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  algorandAddr: text('algorand_addr').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull()
})

// ─── balances ────────────────────────────────────────────────────────────────
// Mutable current balance in USDC atomic units (1 USDC = 1_000_000).
// One row per user. Updated transactionally with ledger_entries.
export const balances = pgTable(
  'balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    balanceAtomic: bigint('balance_atomic', { mode: 'bigint' })
      .notNull()
      .default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  t => [uniqueIndex('balances_user_id_unique').on(t.userId)]
)

// ─── ledger_entries ──────────────────────────────────────────────────────────
// Immutable audit log. Positive = credit, Negative = debit.
// Never update or delete rows in this table.
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(), // 'algorand_deposit' | 'base_payment' | 'admin_credit' | 'refund'
    refTxId: text('ref_tx_id'), // Base tx hash or Algorand tx id
    algoTxId: text('algo_tx_id'), // for deposit idempotency
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  t => [
    // Prevent crediting the same Algorand deposit twice
    uniqueIndex('ledger_algo_tx_id_unique').on(t.algoTxId)
  ]
)

// ─── payment_attempts ────────────────────────────────────────────────────────
// One row per logical payment. correlation_id is the idempotency key.
// status flow: pending -> paying -> paid | failed
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlationId: text('correlation_id').notNull().unique(), // DB-level idempotency
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sellerNetwork: text('seller_network').notNull(),
    sellerAddress: text('seller_address').notNull(),
    amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('pending'),
    paymentSig: text('payment_sig'),
    errorMsg: text('error_msg'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  t => [
    index('payment_attempts_user_id_idx').on(t.userId),
    index('payment_attempts_status_idx').on(t.status)
  ]
)

// ─── treasury_records ────────────────────────────────────────────────────────
// Audit trail of every outgoing payment from the Base treasury wallet.
export const treasuryRecords = pgTable('treasury_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  chain: text('chain').notNull().default('base'),
  correlationId: text('correlation_id'),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  direction: text('direction').notNull(), // 'payment_out' | 'refill_in'
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull()
})
