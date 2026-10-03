import { describe, it, expect } from 'vitest'
import {
  buildCatalog,
  findOperation,
  getCatalog,
  isExcludedPath
} from '@/lib/mcp/catalog'

const doc = {
  security: [{ BearerJWT: [] }, { NIP98: [] }],
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          owner: { $ref: '#/components/schemas/User' }
        },
        required: ['username']
      },
      User: { type: 'object', properties: { pubkey: { type: 'string' } } },
      Node: {
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/Node' } }
      },
      Choice: {
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'string' } } }
        ]
      }
    },
    parameters: {
      Limit: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer' },
        description: 'Page size.'
      }
    }
  },
  paths: {
    '/api/things/{id}': {
      parameters: [],
      summary: 'path-level fields are not operations',
      get: {
        operationId: 'things.get',
        summary: 'Get a thing.',
        description: 'Longer text.',
        tags: ['Things'],
        'x-required-role': 'VIEWER',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { $ref: '#/components/parameters/Limit' },
          { name: 'x-trace', in: 'header', schema: { type: 'string' } }
        ]
      },
      put: {
        operationId: 'things.update',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Address' }
            }
          }
        }
      },
      post: {
        operationId: 'things.choose',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Choice' }
            }
          }
        }
      },
      patch: {
        operationId: 'things.recurse',
        security: [{}, { BearerJWT: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Node',
                description: 'A linked node.'
              }
            }
          }
        }
      },
      delete: {
        security: [{ NIP98: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { id: { type: 'string' } }
              }
            }
          }
        }
      },
      options: 'not an operation object'
    },
    '/api/refs': {
      post: {
        operationId: 'refs.unresolved',
        tags: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  missing: {
                    $ref: '#/components/schemas/Missing',
                    description: 'kept'
                  },
                  remote: { $ref: 'https://example.com/schema.json' }
                }
              }
            }
          }
        }
      }
    },
    '/api/mcp': { post: { operationId: 'mcp.call' } },
    '/api/oauth/token': { post: { operationId: 'oauth.token' } },
    '/api/eventsx': { get: { operationId: 'not.excluded' } }
  }
}

const byId = (id: string) => {
  const op = buildCatalog(doc).find(o => o.operationId === id)
  if (!op) throw new Error(`missing ${id}`)
  return op
}

describe('buildCatalog', () => {
  it('lists operations, skipping excluded prefixes and non-operations', () => {
    expect(buildCatalog(doc).map(op => op.operationId)).toEqual([
      'things.get',
      'things.update',
      'things.choose',
      'things.recurse',
      'DELETE /api/things/{id}',
      'refs.unresolved',
      'not.excluded'
    ])
  })

  it('maps path and query parameters, resolving parameter refs', () => {
    const op = byId('things.get')
    expect(op).toMatchObject({
      method: 'GET',
      path: '/api/things/{id}',
      summary: 'Get a thing.',
      description: 'Longer text.',
      tag: 'Things',
      requiredRole: 'VIEWER',
      security: 'bearer',
      pathParams: ['id'],
      queryParams: ['limit'],
      body: 'none'
    })
    expect(op.inputSchema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        limit: { type: 'integer', description: 'Page size.' }
      },
      required: ['id']
    })
  })

  it('flattens an object body and inlines nested refs', () => {
    const op = byId('things.update')
    expect(op.body).toBe('flat')
    expect(op.inputSchema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
        owner: { type: 'object', properties: { pubkey: { type: 'string' } } }
      },
      required: ['id', 'username']
    })
  })

  it('nests non-object bodies and bodies that clash with a parameter', () => {
    const choose = byId('things.choose')
    expect(choose.body).toBe('nested')
    expect(choose.security).toBe('public')
    expect(choose.inputSchema.required).toEqual(['body'])
    expect(
      (choose.inputSchema.properties as Record<string, unknown>).body
    ).toHaveProperty('oneOf')

    const clash = byId('DELETE /api/things/{id}')
    expect(clash.body).toBe('nested')
    expect(clash.security).toBe('other')
    expect(clash.requiredRole).toBeNull()
    expect(clash.summary).toBe('')
  })

  it('stops recursive refs after one level', () => {
    const op = byId('things.recurse')
    expect(op.security).toBe('public') // `{}` = anonymous allowed
    expect(op.body).toBe('flat')
    expect(op.inputSchema).toEqual({
      type: 'object',
      properties: { next: {} }
    })
  })

  it('drops unresolvable and remote refs, keeping their siblings', () => {
    const op = byId('refs.unresolved')
    expect(op.tag).toBeNull()
    expect(op.security).toBe('bearer') // document default
    expect(op.inputSchema.properties).toEqual({
      missing: { description: 'kept' },
      remote: {}
    })
    expect(JSON.stringify(op.inputSchema)).not.toContain('$ref')
  })

  it('treats a document without components or paths as empty', () => {
    expect(buildCatalog({})).toEqual([])
  })
})

describe('isExcludedPath', () => {
  it('matches the prefix itself and its children only', () => {
    expect(isExcludedPath('/api/mcp')).toBe(true)
    expect(isExcludedPath('/api/mcp/public')).toBe(true)
    expect(isExcludedPath('/api/events')).toBe(true)
    expect(isExcludedPath('/api/eventsx')).toBe(false)
    expect(isExcludedPath('/api/cards')).toBe(false)
  })
})

describe('getCatalog (live OpenAPI document)', () => {
  it('is memoized', () => {
    expect(getCatalog()).toBe(getCatalog())
  })

  it('never includes the MCP, OAuth or plumbing endpoints', () => {
    for (const op of getCatalog()) expect(isExcludedPath(op.path)).toBe(false)
  })

  it('has unique operationIds and resolvable lookups', () => {
    const ids = getCatalog().map(op => op.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(findOperation('cards.get')?.path).toBe('/api/cards/{id}')
    expect(findOperation('nope')).toBeUndefined()
  })

  it('produces self-contained object schemas for every operation', () => {
    for (const op of getCatalog()) {
      expect(op.operationId).not.toMatch(/\s/) // every operation has an id
      expect(op.inputSchema.type).toBe('object')
      expect(JSON.stringify(op.inputSchema)).not.toContain('"$ref"')
      for (const name of Object.keys(
        op.inputSchema.properties as Record<string, unknown>
      )) {
        expect(name).toMatch(/^[A-Za-z0-9_.-]{1,64}$/)
      }
    }
  })
})
