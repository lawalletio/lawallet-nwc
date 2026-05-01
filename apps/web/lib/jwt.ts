import jwt from 'jsonwebtoken'

/** Decoded JWT payload used by this app. Open via index signature for custom claims. */
export interface JwtPayload {
  /** Subject — typically the user's DB id. */
  userId: string
  /** Hex-encoded Nostr pubkey of the actor. */
  pubkey: string
  /** Issued-at, epoch seconds. */
  iat: number
  /** Expiration, epoch seconds. */
  exp: number
  /** Additional claims (role, etc.). */
  [key: string]: any
}

/** Result returned by the verify/decode helpers — payload plus the JOSE header. */
export interface JwtValidationResult {
  payload: JwtPayload
  header: any
}

/**
 * Signs a JWT. `iat`, `exp`, and `pubkey` are intentionally excluded from
 * `payload` — `iat`/`exp` come from `expiresIn`, and `pubkey` is added by the
 * caller as part of the broader claims it spreads in.
 *
 * @returns The encoded JWT (`xxx.yyy.zzz`).
 */
export function createJwtToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'pubkey'>,
  secret: string,
  options: {
    expiresIn?: string | number
    algorithm?: jwt.Algorithm
    issuer?: string
    audience?: string
  } = {}
): string {
  const { expiresIn = '1h', algorithm = 'HS256', issuer, audience } = options

  const jwtOptions: jwt.SignOptions = {
    algorithm,
    expiresIn: expiresIn as any
  }

  if (issuer) jwtOptions.issuer = issuer
  if (audience) jwtOptions.audience = audience

  return jwt.sign(payload, secret, jwtOptions)
}

/**
 * Verifies and decodes a JWT token.
 *
 * @param token - The JWT token to verify
 * @param secret - The secret key to verify the JWT
 * @param options - Additional verification options
 * @returns The decoded payload and header
 * @throws {Error} `'Token has expired'`, `'Invalid token'`, `'Token not active yet'`,
 *   or a wrapped verification error.
 */
export function verifyJwtToken(
  token: string,
  secret: string,
  options: {
    algorithms?: jwt.Algorithm[]
    issuer?: string
    audience?: string
    clockTolerance?: number
  } = {}
): JwtValidationResult {
  const {
    algorithms = ['HS256'],
    issuer,
    audience,
    clockTolerance = 0
  } = options

  const verifyOptions: jwt.VerifyOptions = {
    algorithms
  }

  if (issuer) verifyOptions.issuer = issuer
  if (audience) verifyOptions.audience = audience
  if (clockTolerance > 0) verifyOptions.clockTolerance = clockTolerance

  try {
    const decoded = jwt.verify(token, secret, verifyOptions) as JwtPayload
    const header = jwt.decode(token, { complete: true })?.header

    return {
      payload: decoded,
      header
    }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired')
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token')
    } else if (error instanceof jwt.NotBeforeError) {
      throw new Error('Token not active yet')
    } else {
      throw new Error(
        `Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

/**
 * Decodes a JWT *without* verifying its signature — only safe for inspecting
 * a token (e.g. reading `exp` to schedule a refresh) when you don't yet trust it.
 * Never use the returned claims for authorization.
 *
 * @throws {Error} `'Invalid token format'` or a wrapped decoding error.
 */
export function decodeJwtToken(token: string): JwtValidationResult {
  try {
    const decoded = jwt.decode(token, { complete: true })

    if (!decoded) {
      throw new Error('Invalid token format')
    }

    return {
      payload: decoded.payload as JwtPayload,
      header: decoded.header
    }
  } catch (error) {
    throw new Error(
      `Token decoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Extracts the bearer token from an `Authorization: Bearer <token>` header.
 *
 * @throws {Error} When the header is missing, lacks the `Bearer ` prefix, or is empty.
 */
export function extractJwtFromHeader(authHeader: string | null): string {
  if (!authHeader) {
    throw new Error('Authorization header is required')
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header must start with "Bearer "')
  }

  const token = authHeader.substring(7) // Remove "Bearer " prefix

  if (!token) {
    throw new Error('Token is required')
  }

  return token
}

/**
 * Convenience wrapper: pulls the bearer token from a `Request` and verifies it.
 *
 * @throws {Error} See {@link extractJwtFromHeader} and {@link verifyJwtToken}.
 */
export async function validateJwtFromRequest(
  request: Request,
  secret: string,
  options: {
    algorithms?: jwt.Algorithm[]
    issuer?: string
    audience?: string
    clockTolerance?: number
  } = {}
): Promise<JwtValidationResult> {
  const authHeader = request.headers.get('authorization')
  const token = extractJwtFromHeader(authHeader)

  return verifyJwtToken(token, secret, options)
}

/**
 * Checks whether a decoded payload is past its `exp`.
 *
 * @param clockTolerance - Optional skew, in seconds, applied in the caller's favour.
 */
export function isTokenExpired(
  payload: JwtPayload,
  clockTolerance: number = 0
): boolean {
  const now = Math.floor(Date.now() / 1000)
  return payload.exp < now - clockTolerance
}

/**
 * @returns Seconds until the payload's `exp` (negative when already expired).
 */
export function getTimeUntilExpiration(payload: JwtPayload): number {
  const now = Math.floor(Date.now() / 1000)
  return payload.exp - now
}
