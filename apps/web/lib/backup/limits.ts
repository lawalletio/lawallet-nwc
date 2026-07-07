import type { RequestLimitOptions } from '@/lib/middleware/request-limits'

/**
 * Upload ceiling for the analyze/import endpoints. A real archive is tens of MB
 * — far above the 1 MB `'upload'` preset — so these routes use a dedicated
 * limit. Note: a reverse proxy / platform body cap may also need raising in
 * production (Umbrel / Start9 / Docker deployments).
 */
export const BACKUP_UPLOAD_LIMIT: RequestLimitOptions = {
  maxBodySize: 100 * 1024 * 1024,
  maxFileSize: 100 * 1024 * 1024,
  maxFiles: 1,
}
