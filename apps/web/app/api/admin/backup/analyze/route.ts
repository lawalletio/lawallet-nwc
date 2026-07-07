import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkFileLimits, checkRequestLimits } from '@/lib/middleware/request-limits'
import { ValidationError } from '@/types/server/errors'
import { parseBackupFile } from '@/lib/backup/archive'
import { analyzeBackup } from '@/lib/backup/analyze'
import { BACKUP_UPLOAD_LIMIT } from '@/lib/backup/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/admin/backup/analyze` — ADMIN-only. Dry run: parses + validates an
 * uploaded archive and classifies every row against the live DB WITHOUT
 * writing. Returns the conflict plan the restore wizard resolves. The client
 * re-uploads the same file for the import step (server holds no state).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await authenticateWithRole(request, Role.ADMIN)
  await checkRequestLimits(request, BACKUP_UPLOAD_LIMIT)

  const formData = await request.formData()
  checkFileLimits(formData, BACKUP_UPLOAD_LIMIT)

  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ValidationError('A backup file is required.')
  }
  const passwordRaw = formData.get('password')
  const password = typeof passwordRaw === 'string' && passwordRaw !== '' ? passwordRaw : undefined

  const parsed = await parseBackupFile(file, password)
  const plan = await analyzeBackup(parsed)

  return NextResponse.json(plan)
})
