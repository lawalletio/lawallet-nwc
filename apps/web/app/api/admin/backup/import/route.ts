import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkFileLimits, checkRequestLimits } from '@/lib/middleware/request-limits'
import { ValidationError } from '@/types/server/errors'
import { backupImportRequestSchema } from '@/lib/validation/schemas'
import { parseBackupFile } from '@/lib/backup/archive'
import { applyBackup } from '@/lib/backup/import'
import { emitRestoreEvents } from '@/lib/backup/events'
import { BACKUP_UPLOAD_LIMIT } from '@/lib/backup/limits'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/admin/backup/import` — ADMIN-only. Applies an uploaded archive.
 * `mode=merge` resolves conflicts per the `resolution` payload; `mode=replace`
 * wipes the backed-up tables first. Runs in one transaction (atomic) by default.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await authenticateWithRole(request, Role.ADMIN)
  await checkRequestLimits(request, BACKUP_UPLOAD_LIMIT)

  const formData = await request.formData()
  checkFileLimits(formData, BACKUP_UPLOAD_LIMIT)

  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ValidationError('A backup file is required.')
  }
  const passwordRaw = formData.get('password')
  const password = typeof passwordRaw === 'string' && passwordRaw !== '' ? passwordRaw : undefined

  let resolutionJson: unknown = {}
  const resolutionRaw = formData.get('resolution')
  if (typeof resolutionRaw === 'string' && resolutionRaw.trim() !== '') {
    try {
      resolutionJson = JSON.parse(resolutionRaw)
    } catch {
      throw new ValidationError('The resolution payload is not valid JSON.')
    }
  }
  const parsedResolution = backupImportRequestSchema.safeParse(resolutionJson)
  if (!parsedResolution.success) {
    throw new ValidationError('Invalid restore options.', parsedResolution.error.errors)
  }
  const resolution = parsedResolution.data

  const parsed = await parseBackupFile(file, password)
  const result = await applyBackup(parsed, resolution)

  logActivity.fireAndForget({
    category: 'SERVER',
    event: ActivityEvent.SERVER_BACKUP_IMPORTED,
    level: result.hadErrors ? 'WARN' : 'INFO',
    message: `Backup imported (${resolution.mode})`,
    metadata: {
      actorPubkey: auth.pubkey,
      mode: resolution.mode,
      hadErrors: result.hadErrors,
      summary: result.tables,
      errorCount: result.errors.length,
    },
  })

  emitRestoreEvents(result)

  return NextResponse.json(result)
})
