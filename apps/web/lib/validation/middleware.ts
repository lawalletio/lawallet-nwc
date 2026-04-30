import { type ZodType, type ZodTypeDef } from 'zod'
import { ValidationError } from '@/types/server/errors'

/**
 * Parses a JSON request body against a Zod schema and returns the typed result.
 *
 * @throws {ValidationError} On a parse failure; carries the Zod issue list as `details`.
 */
export async function validateBody<TOutput, TDef extends ZodTypeDef, TInput>(
  request: Request,
  schema: ZodType<TOutput, TDef, TInput>
): Promise<TOutput> {
  const body = await request.json()
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
