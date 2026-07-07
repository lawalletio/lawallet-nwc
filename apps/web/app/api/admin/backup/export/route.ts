import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { backupExportRequestSchema } from '@/lib/validation/schemas'
import { buildBackup } from '@/lib/backup/export'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

// Reads full rows (incl. secrets) and builds a zip in memory — Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/admin/backup/export` — ADMIN-only. Gathers the selected categories
 * into a downloadable zip (optionally password-encrypted). The archive contains
 * plaintext secrets, so the response is marked `no-store`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await authenticateWithRole(request, Role.ADMIN)
  await checkRequestLimits(request, 'json')
  const body = await validateBody(request, backupExportRequestSchema)

  const { buffer, manifest, filename } = await buildBackup(
    body.categories,
    body.options,
    body.password,
  )

  logActivity.fireAndForget({
    category: 'SERVER',
    event: ActivityEvent.SERVER_BACKUP_EXPORTED,
    level: 'INFO',
    message: `Backup exported (${manifest.categories.join(', ')})`,
    metadata: {
      actorPubkey: auth.pubkey,
      categories: manifest.categories,
      encrypted: manifest.encrypted,
      // Only counts — never serialize the secret values themselves.
      counts: Object.fromEntries(
        Object.entries(manifest.tables).map(([table, meta]) => [table, meta?.count ?? 0]),
      ),
    },
  })

  const bytes = new Uint8Array(buffer)
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
    },
  })
})
