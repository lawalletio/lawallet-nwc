import { z } from 'zod'
import { inlineJsonResponse, publicErrorResponses, publicSecurity, withRole } from '../helpers'
import { registry } from '../registry'

const TAG = 'Version'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/version',
  tags: [TAG],
  summary: 'Check the running web app version and latest GitHub release.',
  operationId: 'version.get',
  security: publicSecurity,
  responses: {
    200: inlineJsonResponse(
      'Current version and latest release status.',
      z.object({
        currentVersion: z.string(),
        latestVersion: z.string().nullable(),
        releaseUrl: z.string().url(),
        updateAvailable: z.boolean(),
      }),
    ),
    ...publicErrorResponses,
  },
})
