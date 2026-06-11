import { HTTPException } from 'hono/http-exception'
import { DesktopAuthError } from './auth.js'

export class InsufficientBalanceError extends Error {
  constructor(available: bigint, required: bigint) {
    super(
      `Insufficient balance: have ${available} atomic units, need ${required}`
    )
    this.name = 'InsufficientBalanceError'
  }
}

export class UserNotFoundError extends Error {
  constructor(algorandAddr: string) {
    super(`User not found for Algorand address: ${algorandAddr}`)
    this.name = 'UserNotFoundError'
  }
}

export class DuplicateDepositError extends Error {
  constructor(algoTxId: string) {
    super(`Deposit already credited for Algorand tx: ${algoTxId}`)
    this.name = 'DuplicateDepositError'
  }
}

export class UnsupportedNetworkError extends Error {
  constructor(network: string) {
    super(`Unsupported seller network: ${network}`)
    this.name = 'UnsupportedNetworkError'
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.trim()
    if (message) return message
    return err.name.trim() || 'Internal server error'
  }
  if (typeof err === 'string') {
    const message = err.trim()
    if (message) return message
  }
  return 'Internal server error'
}

export function toHttpException(err: unknown): HTTPException {
  if (err instanceof InsufficientBalanceError) {
    return new HTTPException(402, { message: err.message })
  }
  if (err instanceof UserNotFoundError) {
    return new HTTPException(404, { message: err.message })
  }
  if (err instanceof DuplicateDepositError) {
    return new HTTPException(409, { message: err.message })
  }
  if (err instanceof UnsupportedNetworkError) {
    return new HTTPException(400, { message: err.message })
  }
  if (err instanceof DesktopAuthError) {
    return new HTTPException(401, { message: err.message })
  }
  const message = describeError(err)
  return new HTTPException(500, { message })
}
