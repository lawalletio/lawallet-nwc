import { describe, it, expect } from 'vitest'
import {
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  TooManyRequestsError,
  InternalServerError,
} from '@/types/server/errors'

describe('ApiError', () => {
  it('sets all properties', () => {
    const err = new ApiError('test', {
      statusCode: 418,
      code: 'TEAPOT',
      details: { foo: 'bar' },
      cause: new Error('root'),
    })
    expect(err.message).toBe('test')
    expect(err.statusCode).toBe(418)
    expect(err.code).toBe('TEAPOT')
    expect(err.details).toEqual({ foo: 'bar' })
    expect(err.cause).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.name).toBe('ApiError')
  })
})

describe('ValidationError', () => {
  it('has correct defaults', () => {
    const err = new ValidationError()
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('Validation error')
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.name).toBe('ValidationError')
  })

  it('accepts custom message and details', () => {
    const err = new ValidationError('bad input', { field: 'name' })
    expect(err.message).toBe('bad input')
    expect(err.details).toEqual({ field: 'name' })
  })
})

describe('AuthenticationError', () => {
  it('has correct defaults', () => {
    const err = new AuthenticationError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('AUTHENTICATION_ERROR')
    expect(err.message).toBe('Authentication required')
    expect(err.name).toBe('AuthenticationError')
  })
})

describe('AuthorizationError', () => {
  it('has correct defaults', () => {
    const err = new AuthorizationError()
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('AUTHORIZATION_ERROR')
    expect(err.message).toBe('Not authorized')
    expect(err.name).toBe('AuthorizationError')
  })
})

describe('NotFoundError', () => {
  it('has correct defaults', () => {
    const err = new NotFoundError()
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Resource not found')
    expect(err.name).toBe('NotFoundError')
  })
})

describe('ConflictError', () => {
  it('has correct defaults', () => {
    const err = new ConflictError()
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
    expect(err.message).toBe('Conflict')
    expect(err.name).toBe('ConflictError')
  })
})

describe('PayloadTooLargeError', () => {
  it('has correct defaults', () => {
    const err = new PayloadTooLargeError()
    expect(err.statusCode).toBe(413)
    expect(err.code).toBe('PAYLOAD_TOO_LARGE')
    expect(err.message).toBe('Payload too large')
    expect(err.name).toBe('PayloadTooLargeError')
  })
})

describe('ServiceUnavailableError', () => {
  it('has correct defaults', () => {
    const err = new ServiceUnavailableError()
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
    expect(err.message).toBe('Service temporarily unavailable')
    expect(err.name).toBe('ServiceUnavailableError')
  })
})

describe('TooManyRequestsError', () => {
  it('has correct defaults', () => {
    const err = new TooManyRequestsError()
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('TOO_MANY_REQUESTS')
    expect(err.message).toBe('Too many requests')
    expect(err.retryAfter).toBe(60)
    expect(err.name).toBe('TooManyRequestsError')
  })

  it('accepts custom retryAfter', () => {
    const err = new TooManyRequestsError('slow down', { retryAfter: 120 })
    expect(err.retryAfter).toBe(120)
    expect(err.message).toBe('slow down')
  })

  it('accepts details', () => {
    const err = new TooManyRequestsError('rate limited', {
      retryAfter: 30,
      details: { ip: '1.2.3.4' },
    })
    expect(err.details).toEqual({ ip: '1.2.3.4' })
  })
})

describe('InternalServerError', () => {
  it('has correct defaults', () => {
    const err = new InternalServerError()
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    expect(err.message).toBe('Internal server error')
    expect(err.name).toBe('InternalServerError')
  })

  it('chains cause', () => {
    const cause = new Error('db connection failed')
    const err = new InternalServerError('server broke', { cause })
    expect(err.cause).toBe(cause)
  })

  it('accepts details', () => {
    const err = new InternalServerError('oops', { details: 'stack overflow' })
    expect(err.details).toBe('stack overflow')
  })
})
