import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import { users } from '../db/schema.js'
import { verifyDesktopPayRequest } from '../core/auth.js'
import {
  describeError,
  InsufficientBalanceError,
  UnsupportedNetworkError,
  toHttpException
} from '../core/errors.js'
import { createX402Payment } from '../x402/create-payment.js'
import {
  getPaymentAmountAtomic,
  getSellerAddress,
  parsePaymentRequirements,
  resolveSellerNetwork
} from '../x402/parse-payment.js'

interface HubPayRequest {
  correlationId: string
  sellerNetwork?: string
  paymentRequirements: unknown
  userContext: {
    algorandAddress: string
    maxDebitAtomic: string
  }
}

interface HubPayResponse {
  success: boolean
  paymentSignature?: string
  settlementNetwork?: string
  error?: string
}

async function getOrCreateUser(algorandAddr: string) {
  const existing = await db.query.users.findFirst({
    where: eq(users.algorandAddr, algorandAddr)
  })
  if (existing) return existing

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (algorand_addr) VALUES ($1)
       ON CONFLICT (algorand_addr) DO UPDATE SET algorand_addr = EXCLUDED.algorand_addr
       RETURNING id`,
      [algorandAddr]
    )
    const userId = userResult.rows[0].id
    await client.query(
      `INSERT INTO balances (user_id, balance_atomic) VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )
    await client.query('COMMIT')
    return { id: userId, algorandAddr, createdAt: new Date() }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function payHandler(c: Context): Promise<Response> {
  const rawBody = await c.req.text()
  let body: HubPayRequest
  let stage = 'parse_request'

  try {
    body = JSON.parse(rawBody) as HubPayRequest
  } catch {
    return c.json<HubPayResponse>(
      { success: false, error: 'Invalid JSON body' },
      400
    )
  }

  const { correlationId, paymentRequirements: rawReq, userContext } = body

  if (!correlationId || !rawReq || !userContext?.algorandAddress) {
    return c.json<HubPayResponse>(
      { success: false, error: 'Missing required fields' },
      400
    )
  }

  try {
    stage = 'verify_desktop_auth'
    verifyDesktopPayRequest({
      headers: {
        authVersion: c.req.header('x-pixa-auth-version'),
        address: c.req.header('x-pixa-address'),
        timestamp: c.req.header('x-pixa-timestamp'),
        nonce: c.req.header('x-pixa-nonce'),
        bodySha256: c.req.header('x-pixa-body-sha256'),
        signature: c.req.header('x-pixa-signature')
      },
      rawBody,
      requestBody: body
    })

    stage = 'parse_payment_requirements'
    const payReq = parsePaymentRequirements(rawReq)

    stage = 'resolve_seller_network'
    const sellerNetwork = resolveSellerNetwork(payReq)
    if (!sellerNetwork) {
      throw new UnsupportedNetworkError(
        'No supported network in paymentRequirements'
      )
    }

    stage = 'extract_seller_details'
    const sellerAddress = getSellerAddress(payReq, sellerNetwork)
    const amountAtomic = getPaymentAmountAtomic(payReq, sellerNetwork)

    stage = 'check_user_limit'
    const maxDebit = BigInt(userContext.maxDebitAtomic)
    if (amountAtomic > maxDebit) {
      return c.json<HubPayResponse>(
        {
          success: false,
          error: `Amount ${amountAtomic} exceeds user maxDebitAtomic ${maxDebit}`
        },
        402
      )
    }

    stage = 'load_user'
    const user = await getOrCreateUser(userContext.algorandAddress)

    const client = await pool.connect()
    try {
      stage = 'reserve_balance'
      await client.query('BEGIN')

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO payment_attempts (correlation_id, user_id, seller_network, seller_address, amount_atomic, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (correlation_id) DO NOTHING
         RETURNING id`,
        [
          correlationId,
          user.id,
          sellerNetwork,
          sellerAddress,
          amountAtomic.toString()
        ]
      )

      if (insertResult.rows.length === 0) {
        const existing = await client.query<{
          status: string
          payment_sig: string | null
          error_msg: string | null
          seller_network: string
        }>(
          `SELECT status, payment_sig, error_msg, seller_network
           FROM payment_attempts WHERE correlation_id = $1`,
          [correlationId]
        )
        await client.query('COMMIT')

        const row = existing.rows[0]
        if (row?.status === 'paid' && row.payment_sig) {
          return c.json<HubPayResponse>({
            success: true,
            paymentSignature: row.payment_sig,
            settlementNetwork: row.seller_network
          })
        }
        if (row?.status === 'failed') {
          return c.json<HubPayResponse>(
            { success: false, error: row.error_msg ?? 'Payment failed' },
            402
          )
        }
        return c.json<HubPayResponse>(
          { success: false, error: 'Payment in progress, retry shortly' },
          202
        )
      }

      stage = 'check_balance'
      const balanceResult = await client.query<{ balance_atomic: string }>(
        `SELECT balance_atomic FROM balances WHERE user_id = $1 FOR UPDATE`,
        [user.id]
      )
      const currentBalance = BigInt(
        balanceResult.rows[0]?.balance_atomic ?? '0'
      )

      if (currentBalance < amountAtomic) {
        await client.query(
          `DELETE FROM payment_attempts WHERE correlation_id = $1`,
          [correlationId]
        )
        await client.query('COMMIT')
        throw new InsufficientBalanceError(currentBalance, amountAtomic)
      }

      stage = 'debit_balance'
      await client.query(
        `UPDATE balances SET balance_atomic = balance_atomic - $1, updated_at = now() WHERE user_id = $2`,
        [amountAtomic.toString(), user.id]
      )
      await client.query(
        `UPDATE payment_attempts SET status = 'paying', updated_at = now() WHERE correlation_id = $1`,
        [correlationId]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      client.release()
      throw err
    }

    client.release()

    let paymentSignature: string
    try {
      stage = 'create_x402_payment'
      const result = await createX402Payment({
        paymentRequirements: payReq,
        sellerNetwork
      })
      paymentSignature = result.paymentSignature
    } catch (payErr) {
      console.error('[pay] createX402Payment failed', {
        stage,
        correlationId,
        sellerNetwork,
        sellerAddress,
        amountAtomic: amountAtomic.toString(),
        error: describeError(payErr),
        stack: payErr instanceof Error ? payErr.stack : undefined
      })

      const rollbackClient = await pool.connect()
      try {
        await rollbackClient.query('BEGIN')
        await rollbackClient.query(
          `UPDATE balances SET balance_atomic = balance_atomic + $1, updated_at = now() WHERE user_id = $2`,
          [amountAtomic.toString(), user.id]
        )
        await rollbackClient.query(
          `UPDATE payment_attempts SET status = 'failed', error_msg = $1, updated_at = now() WHERE correlation_id = $2`,
          [describeError(payErr), correlationId]
        )
        await rollbackClient.query('COMMIT')
      } catch {
        await rollbackClient.query('ROLLBACK')
      } finally {
        rollbackClient.release()
      }
      throw payErr
    }

    stage = 'finalize_payment'
    const settleClient = await pool.connect()
    try {
      await settleClient.query('BEGIN')
      await settleClient.query(
        `UPDATE payment_attempts
         SET status = 'paid', payment_sig = $1, updated_at = now()
         WHERE correlation_id = $2`,
        [paymentSignature, correlationId]
      )
      await settleClient.query(
        `INSERT INTO ledger_entries (user_id, amount_atomic, reason, ref_tx_id)
         VALUES ($1, $2, 'base_payment', $3)`,
        [user.id, (-amountAtomic).toString(), correlationId]
      )
      await settleClient.query(
        `INSERT INTO treasury_records (chain, correlation_id, amount_atomic, direction)
         VALUES ('base', $1, $2, 'payment_out')`,
        [correlationId, amountAtomic.toString()]
      )
      await settleClient.query('COMMIT')
    } catch (err) {
      await settleClient.query('ROLLBACK')
      console.error('[pay] Audit log failed after successful payment:', {
        stage,
        correlationId,
        sellerNetwork,
        error: describeError(err),
        stack: err instanceof Error ? err.stack : undefined
      })
    } finally {
      settleClient.release()
    }

    return c.json<HubPayResponse>({
      success: true,
      paymentSignature,
      settlementNetwork: sellerNetwork
    })
  } catch (err) {
    console.error('[pay] request failed', {
      stage,
      correlationId: body?.correlationId,
      sellerNetwork: body?.sellerNetwork,
      algorandAddress: body?.userContext?.algorandAddress,
      error: describeError(err),
      stack: err instanceof Error ? err.stack : undefined
    })

    const httpErr = toHttpException(err)
    return c.json<HubPayResponse>(
      { success: false, error: httpErr.message || 'Internal server error' },
      httpErr.status as 400 | 402 | 404 | 409 | 500
    )
  }
}
