import { type ZodType, type ZodTypeDef } from 'zod'
import { ValidationError } from '@/types/server/errors'

/**
 * Error thrown when the request body cannot be parsed as JSON.
 * Extends ValidationError so it's a 400 Bad Request, but the distinct type
 * lets handlers distinguish between JSON parse errors and schema validation
 * errors when they need different behavior (e.g. optional body endpoints).
 */
export class JsonParseError extends ValidationError {
  constructor(message = 'Malformed JSON in request body') {
    super(message)
    this.name = 'JsonParseError'
  }
}

/**
 * Parses a JSON request body against a Zod schema and returns the typed result.
 *
 * @throws {JsonParseError} When the body is not valid JSON (empty, truncated,
 *   or malformed). This is a 400 Bad Request.
 * @throws {ValidationError} On schema validation failure; carries the Zod
 *   issue list as `details`.
 */
export async function validateBody<TOutput, TDef extends ZodTypeDef, TInput>(
  request: Request,
  schema: ZodType<TOutput, TDef, TInput>
): Promise<TOutput> {
  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new JsonParseError()
    }
    throw err
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.errors)
  }
  return result.data
}

/**
 * Validates query string parameters from a URL (or URL string) against a Zod schema.
 * Repeated keys collapse to the last value because we materialise via `Object.fromEntries`.
 *
 * @throws {ValidationError} On a parse failure; carries the Zod issue list as `details`.
 */
export function validateQuery<TOutput, TDef extends ZodTypeDef, TInput>(
  url: URL | string,
  schema: ZodType<TOutput, TDef, TInput>
): TOutput {
  const parsed = typeof url === 'string' ? new URL(url) : url
  const params = Object.fromEntries(parsed.searchParams.entries())
  const result = schema.safeParse(params)
  if (!result.success) {
    throw new ValidationError('Invalid query parameters', result.error.errors)
  }
  return result.data
}

/**
 * Validates a Next.js App Router `params` object against a Zod schema.
 * Callers should `await` the route's `params` promise before passing it in.
 *
 * @throws {ValidationError} On a parse failure; carries the Zod issue list as `details`.
 */
export function validateParams<TOutput, TDef extends ZodTypeDef, TInput>(
  params: Record<string, string>,
  schema: ZodType<TOutput, TDef, TInput>
): TOutput {
  const result = schema.safeParse(params)
  if (!result.success) {
    throw new ValidationError('Invalid path parameters', result.error.errors)
  }
  return result.data
}
