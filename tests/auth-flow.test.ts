/**
 * Auth Flow Tests
 *
 * Tests the authentication system without needing external services.
 * Covers: dev mode, auth disabled, API key, JWT (valid + expired).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { authenticateConnection, extractTokenFromRequest } from '../src/auth/index.js'
import { pushEnv, popEnv } from './helpers/setup.js'

describe('Auth - authenticateConnection', () => {
  const envKeys = ['CHITU_AUTH_DISABLED', 'CHITU_API_KEY', 'CHITU_JWT_SECRET']

  beforeEach(() => {
    pushEnv(envKeys)
  })

  afterEach(() => {
    popEnv()
  })

  it('no keys configured = dev mode, connection allowed', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    delete process.env.CHITU_JWT_SECRET

    const result = authenticateConnection(undefined)
    expect(result.success).toBe(true)
  })

  it('CHITU_AUTH_DISABLED=true always allows connection', () => {
    process.env.CHITU_AUTH_DISABLED = 'true'
    process.env.CHITU_API_KEY = 'some-key'
    process.env.CHITU_JWT_SECRET = 'some-secret'

    const result = authenticateConnection(undefined)
    expect(result.success).toBe(true)
  })

  it('valid API key passes verifyClient', () => {
    delete process.env.CHITU_AUTH_DISABLED
    process.env.CHITU_API_KEY = 'test-api-key-12345'
    delete process.env.CHITU_JWT_SECRET

    const result = authenticateConnection('test-api-key-12345')
    expect(result.success).toBe(true)
    expect(result.method).toBe('apikey')
  })

  it('invalid API key is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    process.env.CHITU_API_KEY = 'test-api-key-12345'
    delete process.env.CHITU_JWT_SECRET

    const result = authenticateConnection('wrong-key')
    expect(result.success).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('missing token when keys are configured is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    process.env.CHITU_API_KEY = 'test-api-key-12345'
    delete process.env.CHITU_JWT_SECRET

    const result = authenticateConnection(undefined)
    expect(result.success).toBe(false)
    expect(result.reason).toContain('Missing')
  })

  it('JWT with correct secret passes', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'jwt-secret-key'

    const token = createTestJwt({ sub: 'user-1' }, 'jwt-secret-key')
    const result = authenticateConnection(token)

    expect(result.success).toBe(true)
    expect(result.method).toBe('jwt')
  })

  it('JWT with wrong secret is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'correct-secret'

    const token = createTestJwt({ sub: 'user-1' }, 'wrong-secret')
    const result = authenticateConnection(token)

    expect(result.success).toBe(false)
    // authenticateConnection falls through to generic error when JWT verification fails
    expect(result.reason).toContain('Invalid')
  })

  it('expired JWT is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'jwt-secret-key'

    // exp = 1 hour ago (in seconds)
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600
    const token = createTestJwt({ sub: 'user-1', exp: expiredTimestamp }, 'jwt-secret-key')

    const result = authenticateConnection(token)
    expect(result.success).toBe(false)
    // authenticateConnection returns generic error after failed JWT verification
    expect(result.reason).toContain('Invalid')
  })

  it('JWT without exp field is accepted (no expiration)', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'jwt-secret-key'

    const token = createTestJwt({ sub: 'user-1' }, 'jwt-secret-key')
    const result = authenticateConnection(token)

    expect(result.success).toBe(true)
    expect(result.method).toBe('jwt')
  })

  it('malformed JWT (wrong number of parts) is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'jwt-secret-key'

    const result = authenticateConnection('not.a.valid.jwt.token')
    expect(result.success).toBe(false)
  })

  it('API key is tried before JWT when both are configured', () => {
    delete process.env.CHITU_AUTH_DISABLED
    process.env.CHITU_API_KEY = 'my-api-key'
    process.env.CHITU_JWT_SECRET = 'my-jwt-secret'

    // API key match
    const apiResult = authenticateConnection('my-api-key')
    expect(apiResult.success).toBe(true)
    expect(apiResult.method).toBe('apikey')

    // JWT match (API key fails first, then JWT succeeds)
    const jwtToken = createTestJwt({ sub: 'user-1' }, 'my-jwt-secret')
    const jwtResult = authenticateConnection(jwtToken)
    expect(jwtResult.success).toBe(true)
    expect(jwtResult.method).toBe('jwt')
  })

  it('token that matches neither API key nor JWT is rejected', () => {
    delete process.env.CHITU_AUTH_DISABLED
    process.env.CHITU_API_KEY = 'my-api-key'
    process.env.CHITU_JWT_SECRET = 'my-jwt-secret'

    const result = authenticateConnection('some-random-token')
    expect(result.success).toBe(false)
    expect(result.reason).toContain('Invalid')
  })

  it('JWT authentication succeeds regardless of payload content', () => {
    delete process.env.CHITU_AUTH_DISABLED
    delete process.env.CHITU_API_KEY
    process.env.CHITU_JWT_SECRET = 'jwt-secret-key'

    const token = createTestJwt(
      { sub: 'user-1', userId: 'user-42', orgId: 'org-99' },
      'jwt-secret-key',
    )
    const result = authenticateConnection(token)

    expect(result.success).toBe(true)
    expect(result.method).toBe('jwt')
    // Note: authenticateConnection does not forward userId/orgId from verifyJwt
  })
})

describe('Auth - extractTokenFromRequest', () => {
  it('extracts token from query parameter', () => {
    const req = { url: '/?token=my-token-value' }
    expect(extractTokenFromRequest(req)).toBe('my-token-value')
  })

  it('extracts token from query with other params', () => {
    const req = { url: '/?foo=bar&token=my-token&baz=qux' }
    expect(extractTokenFromRequest(req)).toBe('my-token')
  })

  it('returns undefined when no token param', () => {
    const req = { url: '/?foo=bar' }
    expect(extractTokenFromRequest(req)).toBeUndefined()
  })

  it('returns undefined when no URL', () => {
    const req = { url: undefined }
    expect(extractTokenFromRequest(req)).toBeUndefined()
  })

  it('decodes URL-encoded token', () => {
    const req = { url: '/?token=my%20token%20value' }
    expect(extractTokenFromRequest(req)).toBe('my token value')
  })
})

// ===== Helpers =====

/**
 * Create a minimal JWT token (HS256) for testing.
 *
 * This does NOT use any external library -- it manually constructs
 * the header.payload.signature format.
 */
function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' }

  const headerB64 = Buffer.from(JSON.stringify(header))
    .toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload))
    .toString('base64url')

  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  return `${headerB64}.${payloadB64}.${signature}`
}
