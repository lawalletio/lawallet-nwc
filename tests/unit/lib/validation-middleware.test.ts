import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateBody, validateQuery, validateParams } from '@/lib/validation/middleware'
import { ValidationError } from '@/types/server/errors'

describe('Validation Middleware', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    age: z.number().optional(),
  })

  describe('validateBody', () => {
    it('parses valid JSON body', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      })
      const result = await validateBody(request, testSchema)
      expect(result).toEqual({ name: 'Alice' })
    })

    it('parses body with optional fields', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', age: 30 }),
      })
      const result = await validateBody(request, testSchema)
      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('throws ValidationError for invalid body', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      await expect(validateBody(request, testSchema)).rejects.toThrow(ValidationError)
    })

    it('throws ValidationError for missing required fields', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await expect(validateBody(request, testSchema)).rejects.toThrow(ValidationError)
    })
  })

  describe('validateQuery', () => {
    const querySchema = z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
    })

    it('parses valid query parameters', () => {
      const result = validateQuery('http://localhost?page=1&limit=10', querySchema)
      expect(result).toEqual({ page: '1', limit: '10' })
    })

    it('parses URL object', () => {
      const url = new URL('http://localhost?page=2')
      const result = validateQuery(url, querySchema)
      expect(result).toEqual({ page: '2' })
    })

    it('throws ValidationError for invalid query', () => {
      const strictSchema = z.object({
        amount: z.string().min(1, 'Missing amount'),
      })
      expect(() => validateQuery('http://localhost', strictSchema)).toThrow(ValidationError)
    })
  })

  describe('validateParams', () => {
    const paramSchema = z.object({
      id: z.string().min(1),
    })

    it('parses valid params', () => {
      const result = validateParams({ id: 'abc123' }, paramSchema)
      expect(result).toEqual({ id: 'abc123' })
    })

    it('throws ValidationError for empty params', () => {
      expect(() => validateParams({ id: '' }, paramSchema)).toThrow(ValidationError)
    })

    it('throws ValidationError for missing params', () => {
      expect(() => validateParams({}, paramSchema)).toThrow(ValidationError)
    })
  })
})
