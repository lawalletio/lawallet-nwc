import type { Context } from 'hono'
import type { z } from 'zod'
import { ValidationError } from './errors.js'

export async function parseJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S
): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Request body failed validation', {
      issues: parsed.error.errors
    })
  }
  return parsed.data
}
