# packages/shared — schemas + shared types

**`src/schemas.ts` is the single source of truth for Zod schemas** used by the
web API, the OpenAPI generator, and (eventually) the SDK.

- `apps/web/lib/validation/schemas.ts` is a re-export shim — add/modify
  schemas HERE, not there
- `packages/openapi/src/schemas.ts` registers these schemas for OpenAPI;
  changing a schema shape usually requires a matching update there and in
  `packages/openapi/src/paths/*`
- Exports raw TypeScript (`main`/`types` → `./src/index.ts`); no build step is
  needed for consumers, so don't introduce dist-only exports
