import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { pool } from '../db/client.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import {
  DuplicateDepositError,
  UserNotFoundError,
  toHttpException
} from '../core/errors.js'

interface AdminCreditRequest {
  algorandAddress: string
  amountUsdc: string // human-readable, e.g. "5.00"
  algoTxId: string // Algorand transaction ID — idempotency key
  note?: string
}

export async function adminCreditHandler(c: Context): Promise<Response> {
  let body: AdminCreditRequest
  try {
    body = await c.req.json<AdminCreditRequest>()
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400)
  }

  const { algorandAddress, amountUsdc, algoTxId, note } = body

  if (!algorandAddress || !amountUsdc || !algoTxId) {
    return c.json(
      {
        success: false,
        error: 'algorandAddress, amountUsdc and algoTxId are required'
      },
      400
    )
  }

  const amountFloat = parseFloat(amountUsdc)
  if (isNaN(amountFloat) || amountFloat <= 0) {
    return c.json(
      { success: false, error: 'amountUsdc must be a positive number' },
      400
    )
  }

  // Convert to atomic units (1 USDC = 1_000_000)
  const amountAtomic = BigInt(Math.round(amountFloat * 1_000_000))

  try {
    // Get user — they must already exist (created when they first call /api/pay)
    const user = await db.query.users.findFirst({
      where: eq(users.algorandAddr, algorandAddress)
    })
    if (!user) throw new UserNotFoundError(algorandAddress)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Idempotency: unique constraint on algo_tx_id prevents double-credit
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO ledger_entries (user_id, amount_atomic, reason, algo_tx_id, ref_tx_id)
         VALUES ($1, $2, 'algorand_deposit', $3, $4)
         ON CONFLICT (algo_tx_id) DO NOTHING
         RETURNING id`,
        [user.id, amountAtomic.toString(), algoTxId, note ?? null]
      )

      if (insertResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new DuplicateDepositError(algoTxId)
      }

      // Credit the balance
      await client.query(
        `UPDATE balances SET balance_atomic = balance_atomic + $1, updated_at = now()
         WHERE user_id = $2`,
        [amountAtomic.toString(), user.id]
      )

      // Fetch new balance for response
      const balResult = await client.query<{ balance_atomic: string }>(
        `SELECT balance_atomic FROM balances WHERE user_id = $1`,
        [user.id]
      )

      await client.query('COMMIT')

      const newBalance = BigInt(balResult.rows[0]?.balance_atomic ?? '0')

      return c.json({
        success: true,
        credited: amountAtomic.toString(),
        newBalanceAtomic: newBalance.toString(),
        newBalanceUsdc: (Number(newBalance) / 1_000_000).toFixed(6),
        algoTxId
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const httpErr = toHttpException(err)
    return c.json(
      { success: false, error: httpErr.message },
      httpErr.status as 400 | 404 | 409 | 500
    )
  }
}
