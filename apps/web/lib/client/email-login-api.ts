import type {
  EmailLoginPreviewResponse,
  EmailLoginVerifyResponse
} from '@/lib/validation/schemas'

export class EmailLoginError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new EmailLoginError(
      data?.error?.message || `Request failed (${res.status})`,
      res.status
    )
  }
  return data as T
}

export function requestMagicLink(email: string, locale?: 'en' | 'es') {
  return post<{ ok: true }>('/api/auth/email/request', { email, locale })
}

export function previewMagicLink(token: string) {
  return post<EmailLoginPreviewResponse>('/api/auth/email/preview', { token })
}

export function verifyMagicLink(token: string) {
  return post<EmailLoginVerifyResponse>('/api/auth/email/verify', { token })
}
