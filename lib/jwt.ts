import jwt from 'jsonwebtoken'

export interface JwtPayload {
  userId: string // subject (user ID)
  pubkey: string // public key
  iat: number // issued at
  exp: number // expiration time
  [key: string]: any // allow additional claims
}

export interface JwtValidationResult {
  payload: JwtPayload
  header: any
}

/**
 * Creates a JWT token with the given payload
 * @param payload - The payload to encode in the JWT
 * @param secret - The secret key to sign the JWT
 * @param options - Additional JWT options
 * @returns string - The encoded JWT token
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
 * Verifies and decodes a JWT token
 * @param token - The JWT token to verify
 * @param secret - The secret key to verify the JWT
 * @param options - Additional verification options
 * @returns JwtValidationResult - The decoded payload and header
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
 * Decodes a JWT token without verification (use with caution)
 * @param token - The JWT token to decode
 * @returns JwtValidationResult - The decoded payload and header
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
 * Extracts JWT token from Authorization header
 * @param authHeader - The Authorization header value
 * @returns string - The extracted JWT token
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
 * Validates a JWT token from a Request object
 * @param request - The Request object containing the authorization header
 * @param secret - The secret key to verify the JWT
 * @param options - Additional verification options
 * @returns Promise<JwtValidationResult> - The validated JWT data
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
 * Checks if a JWT token is expired
 * @param payload - The JWT payload
 * @param clockTolerance - Clock tolerance in seconds (default: 0)
 * @returns boolean - True if token is expired
 */
export function isTokenExpired(
  payload: JwtPayload,
  clockTolerance: number = 0
): boolean {
  const now = Math.floor(Date.now() / 1000)
  return payload.exp < now - clockTolerance
}

/**
 * Gets the time until a JWT token expires
 * @param payload - The JWT payload
 * @returns number - Seconds until expiration (negative if expired)
 */
export function getTimeUntilExpiration(payload: JwtPayload): number {
  const now = Math.floor(Date.now() / 1000)
  return payload.exp - now
}
