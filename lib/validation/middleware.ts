import { type ZodType, type ZodTypeDef } from 'zod'
import { ValidationError } from '@/types/server/errors'

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
