export type ApiErrorOptions = {
  statusCode: number
  code: string
  details?: unknown
  cause?: unknown
}

export class ApiError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly details?: unknown
  public readonly cause?: unknown

  constructor(message: string, options: ApiErrorOptions) {
    super(message)
    this.name = new.target.name
    this.statusCode = options.statusCode
    this.code = options.code
    this.details = options.details
    this.cause = options.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation error', details?: unknown) {
    super(message, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details
    })
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, {
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
      details
    })
  }
}

export class AuthorizationError extends ApiError {
  constructor(message = 'Not authorized', details?: unknown) {
    super(message, {
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
      details
    })
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, {
      statusCode: 404,
      code: 'NOT_FOUND',
      details
    })
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, {
      statusCode: 409,
      code: 'CONFLICT',
      details
    })
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message = 'Payload too large', details?: unknown) {
    super(message, {
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      details
    })
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable', details?: unknown) {
    super(message, {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      details
    })
  }
}

export class TooManyRequestsError extends ApiError {
  public readonly retryAfter: number

  constructor(
    message = 'Too many requests',
    options?: { retryAfter?: number; details?: unknown }
  ) {
    super(message, {
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      details: options?.details
    })
    this.retryAfter = options?.retryAfter ?? 60
  }
}

export class InternalServerError extends ApiError {
  constructor(
    message = 'Internal server error',
    options?: { details?: unknown; cause?: unknown }
  ) {
    super(message, {
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      details: options?.details,
      cause: options?.cause
    })
  }
}
