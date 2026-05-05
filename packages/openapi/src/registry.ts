import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// extendZodWithOpenApi mutates the global Zod prototype to add `.openapi()`.
// It must run exactly once before any schema is annotated, so we centralize
// it here and have every other module import the registry from this file.
extendZodWithOpenApi(z)

export const registry = new OpenAPIRegistry()
