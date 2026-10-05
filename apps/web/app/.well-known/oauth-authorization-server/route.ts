import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { resolveApiUrl } from '@/lib/public-url'
import {
  METADATA_CACHE_HEADERS,
  authorizationServerMetadata
} from '@/lib/oauth/metadata'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

export const dynamic = 'force-dynamic'

export const OPTIONS = publicReadOptions

/** RFC 8414 metadata for this instance's OAuth authorization server. */
export const GET = withErrorHandling(
  withPublicReadCors(async (request: NextRequest) =>
    NextResponse.json(
      authorizationServerMetadata(await resolveApiUrl(request)),
      {
        headers: METADATA_CACHE_HEADERS
      }
    )
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
