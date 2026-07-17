import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildProviderPollAuditSignature,
  shouldRecordProviderPollAudit,
} from './provider-poll-audit.js'

test('provider poll audit records first poll and skips unchanged poll', () => {
  const key = `test-${Date.now()}`
  const signature = buildProviderPollAuditSignature({
    pollStatus: 'IN_PROGRESS',
    keyFields: { progress: 10 },
    responseStatus: 200,
    status: 'success',
  })

  assert.equal(shouldRecordProviderPollAudit(key, signature), true)
  assert.equal(shouldRecordProviderPollAudit(key, signature), false)
})

test('provider poll audit records changed key fields and forced errors', () => {
  const key = `test-${Date.now()}`
  const first = buildProviderPollAuditSignature({
    pollStatus: 'IN_PROGRESS',
    keyFields: { stream_url: null },
    responseStatus: 200,
    status: 'success',
  })
  const changed = buildProviderPollAuditSignature({
    pollStatus: 'IN_PROGRESS',
    keyFields: { stream_url: 'https://cdn.example/stream.m3u8' },
    responseStatus: 200,
    status: 'success',
  })

  assert.equal(shouldRecordProviderPollAudit(key, first), true)
  assert.equal(shouldRecordProviderPollAudit(key, changed), true)
  assert.equal(shouldRecordProviderPollAudit(key, changed), false)
  assert.equal(shouldRecordProviderPollAudit(key, changed, true), true)
})
