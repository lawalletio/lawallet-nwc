import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { resolveApiUrl } from '@/lib/public-url'
import { MCP_PATH } from '@/lib/oauth/constants'
import {
  METADATA_CACHE_HEADERS,
  protectedResourceMetadata
} from '@/lib/oauth/metadata'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

export const dynamic = 'force-dynamic'

export const OPTIONS = publicReadOptions

/**
 * RFC 9728 metadata for the MCP endpoint, at
 * `/.well-known/oauth-protected-resource/api/mcp` (the resource path appended,
 * where the 401 challenge points) and at the bare root, which clients fall
 * back to. Any other suffix names no resource of ours.
 */
export const GET = withErrorHandling(
  withPublicReadCors(
    async (
      request: NextRequest,
      { params }: { params: Promise<{ resource?: string[] }> }
    ) => {
      const { resource } = await params
      if (resource && `/${resource.join('/')}` !== MCP_PATH) {
        throw new NotFoundError('No protected resource at this path')
      }
      return NextResponse.json(
        protectedResourceMetadata(await resolveApiUrl(request)),
        { headers: METADATA_CACHE_HEADERS }
      )
    }
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
