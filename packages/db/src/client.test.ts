import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPgPoolConfig } from './client.js'

describe('buildPgPoolConfig', () => {
  test('reads pool limits from environment variables', () => {
    const config = buildPgPoolConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      PG_POOL_MAX: '25',
      PG_IDLE_TIMEOUT_MS: '15000',
      PG_CONNECTION_TIMEOUT_MS: '3000',
    })

    assert.equal(config.connectionString, 'postgresql://user:pass@localhost:5432/app')
    assert.equal(config.max, 25)
    assert.equal(config.idleTimeoutMillis, 15000)
    assert.equal(config.connectionTimeoutMillis, 3000)
  })

  test('ignores invalid numeric pool environment variables', () => {
    const config = buildPgPoolConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      PG_POOL_MAX: '0',
      PG_IDLE_TIMEOUT_MS: '-1',
      PG_CONNECTION_TIMEOUT_MS: 'abc',
    })

    assert.equal(config.connectionString, 'postgresql://user:pass@localhost:5432/app')
    assert.equal(config.max, undefined)
    assert.equal(config.idleTimeoutMillis, undefined)
    assert.equal(config.connectionTimeoutMillis, undefined)
  })
})
