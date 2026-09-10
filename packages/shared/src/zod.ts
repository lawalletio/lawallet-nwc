import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Zod 4 schemas only pick up `.openapi()` if the prototype is patched before
// they are constructed. Next.js may bundle a second `zod` copy for
// `@lawallet-nwc/openapi`, so shared schemas must be created against this
// pre-extended instance — otherwise `registry.register(sharedSchema)` throws
// `openapi is not a function` at build time.
extendZodWithOpenApi(z)

export { z }
