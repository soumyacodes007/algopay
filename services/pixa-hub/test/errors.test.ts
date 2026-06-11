import assert from 'node:assert/strict'
import test from 'node:test'

import { describeError, toHttpException } from '../src/core/errors.js'

test('describeError falls back to a useful message for blank errors', () => {
  assert.equal(describeError(new Error('')), 'Error')
  assert.equal(describeError(''), 'Internal server error')
  assert.equal(describeError(undefined), 'Internal server error')
})

test('toHttpException never returns a blank message for unknown errors', () => {
  const err = toHttpException(new Error(''))
  assert.equal(err.status, 500)
  assert.equal(err.message, 'Error')
})
