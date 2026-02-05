import { getConfig } from '@/lib/config'
import { PayloadTooLargeError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

/**
 * Size limit presets for different endpoint categories.
 *
 * - `json`   — Standard JSON API payloads (uses REQUEST_MAX_JSON_SIZE, default 100 KB)
 * - `large`  — Larger payloads like imports (uses REQUEST_MAX_BODY_SIZE, default 1 MB)
 * - `upload` — File upload endpoints (uses REQUEST_MAX_BODY_SIZE + file constraints)
 */
export type SizePreset = 'json' | 'large' | 'upload'

export interface RequestLimitOptions {
  /** Maximum total body size in bytes */
  maxBodySize: number
  /** Maximum individual file size in bytes (upload preset only) */
  maxFileSize?: number
  /** Maximum number of files allowed (upload preset only) */
  maxFiles?: number
}

/**
 * Resolves a preset name to concrete limit options using app config.
 */
function resolvePreset(preset: SizePreset): RequestLimitOptions {
  const config = getConfig(false)
  const { requestLimits } = config

  switch (preset) {
    case 'json':
      return { maxBodySize: requestLimits.maxJsonSize }
    case 'large':
      return { maxBodySize: requestLimits.maxBodySize }
    case 'upload':
      return {
        maxBodySize: requestLimits.maxBodySize,
        maxFileSize: requestLimits.maxFileSize,
        maxFiles: requestLimits.maxFiles
      }
  }
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Check request body size against configured limits.
 *
 * Uses the Content-Length header for a fast-path check.
 * If Content-Length is absent, clones the request and reads the body
 * to determine the actual size.
 *
 * @param request - The incoming HTTP request
 * @param presetOrOptions - A preset name or custom options
 * @throws {PayloadTooLargeError} If the request exceeds the configured limits
 *
 * @example
 * ```ts
 * // Using a preset
 * export const POST = withErrorHandling(async (request: Request) => {
 *   await checkRequestLimits(request, 'json')
 *   // ... handle request
 * })
 *
 * // Using custom options
 * export const POST = withErrorHandling(async (request: Request) => {
 *   await checkRequestLimits(request, { maxBodySize: 512 * 1024 })
 *   // ... handle request
 * })
 * ```
 */
export async function checkRequestLimits(
  request: Request,
  presetOrOptions: SizePreset | RequestLimitOptions
): Promise<void> {
  const options =
    typeof presetOrOptions === 'string'
      ? resolvePreset(presetOrOptions)
      : presetOrOptions

  const { maxBodySize } = options

  // Skip check for GET, HEAD, DELETE, OPTIONS (no body expected)
  const method = request.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return
  }

  // Fast path: check Content-Length header
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const length = parseInt(contentLength, 10)
    if (!isNaN(length) && length > maxBodySize) {
      logger.warn(
        {
          contentLength: length,
          maxBodySize,
          method,
          url: request.url
        },
        'request.body_too_large'
      )
      throw new PayloadTooLargeError(
        `Request body too large. Maximum size is ${formatBytes(maxBodySize)}.`,
        {
          maxBodySize,
          contentLength: length,
          maxBodySizeHuman: formatBytes(maxBodySize)
        }
      )
    }
    return
  }

  // No Content-Length: if there's a body, read and check
  if (request.body) {
    const clone = request.clone()
    const buffer = await clone.arrayBuffer()
    const actualSize = buffer.byteLength

    if (actualSize > maxBodySize) {
      logger.warn(
        {
          actualSize,
          maxBodySize,
          method,
          url: request.url
        },
        'request.body_too_large'
      )
      throw new PayloadTooLargeError(
        `Request body too large. Maximum size is ${formatBytes(maxBodySize)}.`,
        {
          maxBodySize,
          actualSize,
          maxBodySizeHuman: formatBytes(maxBodySize)
        }
      )
    }
  }
}

/**
 * Check individual file sizes and count in a FormData payload.
 *
 * Call this AFTER parsing FormData in upload endpoints.
 * The overall body size should be checked first with `checkRequestLimits`.
 *
 * @param formData - The parsed FormData
 * @param presetOrOptions - A preset name or custom options with file constraints
 * @throws {PayloadTooLargeError} If any file exceeds limits
 *
 * @example
 * ```ts
 * export const POST = withErrorHandling(async (request: Request) => {
 *   await checkRequestLimits(request, 'upload')
 *   const formData = await request.formData()
 *   checkFileLimits(formData, 'upload')
 *   // ... handle files
 * })
 * ```
 */
export function checkFileLimits(
  formData: FormData,
  presetOrOptions: SizePreset | RequestLimitOptions
): void {
  const options =
    typeof presetOrOptions === 'string'
      ? resolvePreset(presetOrOptions)
      : presetOrOptions

  const { maxFileSize, maxFiles } = options

  // Extract all File entries from FormData
  const files: File[] = []
  formData.forEach((value) => {
    if (value instanceof File) {
      files.push(value)
    }
  })

  // Check file count
  if (maxFiles !== undefined && files.length > maxFiles) {
    logger.warn(
      { fileCount: files.length, maxFiles },
      'request.too_many_files'
    )
    throw new PayloadTooLargeError(
      `Too many files. Maximum is ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`,
      {
        maxFiles,
        fileCount: files.length
      }
    )
  }

  // Check individual file sizes
  if (maxFileSize !== undefined) {
    for (const file of files) {
      if (file.size > maxFileSize) {
        logger.warn(
          {
            fileName: file.name,
            fileSize: file.size,
            maxFileSize
          },
          'request.file_too_large'
        )
        throw new PayloadTooLargeError(
          `File "${file.name}" is too large. Maximum file size is ${formatBytes(maxFileSize)}.`,
          {
            maxFileSize,
            fileSize: file.size,
            fileName: file.name,
            maxFileSizeHuman: formatBytes(maxFileSize)
          }
        )
      }
    }
  }
}
