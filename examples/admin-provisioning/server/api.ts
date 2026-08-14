import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  LaWalletError,
  toPubkey,
  verifyChallengeEvent,
  type NostrEvent
} from '@lawallet-nwc/sdk'
import { createAdminClient, type AdminAuthMode } from './admin-client'
import { mintChallenge, openChallenge } from './challenge'

/**
 * The operator's own backend.
 *
 * A plain `(req, res)` handler with no framework: it is mounted into Vite's
 * dev/preview server here, and would mount unchanged in Express, Fastify or
 * node:http in production.
 *
 * Two endpoints:
 *   POST /api/challenge  → a nonce for the visitor to sign
 *   POST /api/provision  → verify the proof, then provision as admin
 */

export interface ApiOptions {
  endpoint: string
  adminNsec?: string
  authMode: AdminAuthMode
  challengeSecret: string
}

export function readApiOptions(
  env: Record<string, string | undefined>,
  endpoint: string
): ApiOptions {
  return {
    endpoint: env.LAWALLET_ENDPOINT?.replace(/\/+$/, '') || endpoint,
    adminNsec: env.LAWALLET_ADMIN_NSEC,
    authMode: env.LAWALLET_ADMIN_AUTH === 'jwt' ? 'jwt' : 'nip98',
    // Per-boot secret when unset: restarting simply invalidates challenges
    // that are still in flight, which is fine for a demo.
    challengeSecret:
      env.LAWALLET_CHALLENGE_SECRET || randomBytes(32).toString('hex')
  }
}

export function createApiHandler(options: ApiOptions) {
  const admin = options.adminNsec
    ? createAdminClient({
        endpoint: options.endpoint,
        nsec: options.adminNsec,
        authMode: options.authMode
      })
    : null

  /** @returns true when the request was handled. */
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    const path = (req.url ?? '').split('?')[0]
    if (!path.startsWith('/api/')) return false
    if (req.method !== 'POST') return false

    try {
      const body = await readJson(req)

      if (path === '/api/challenge') {
        const pubkey = toPubkey(String(body.pubkey ?? ''))
        send(res, 200, mintChallenge(pubkey, options.challengeSecret))
        return true
      }

      if (path === '/api/provision') {
        if (!admin) {
          throw new LaWalletError(
            503,
            'This deployment has no admin key configured — set LAWALLET_ADMIN_NSEC.',
            'NO_ADMIN_KEY'
          )
        }

        // 1. Unpack the challenge we issued (HMAC + TTL + the pubkey it was for).
        const { pubkey, nonce } = openChallenge(
          String(body.challenge ?? ''),
          options.challengeSecret
        )

        // 2. The visitor must prove they hold that key, right now.
        verifyChallengeEvent(body.event as NostrEvent, nonce, pubkey)

        // 3. Only then spend the admin credential.
        const client = await admin.get()
        const address = await client.addresses.provision({
          username: String(body.username ?? ''),
          pubkey
        })

        send(res, 201, { ...address, authMode: admin.authMode })
        return true
      }

      return false
    } catch (error) {
      const status = error instanceof LaWalletError ? error.status : 400
      const code = error instanceof LaWalletError ? error.code : 'BAD_REQUEST'
      send(res, status, {
        error: {
          message: error instanceof Error ? error.message : 'Request failed',
          code
        }
      })
      return true
    }
  }
}

/**
 * Logs which credential the backend will use, and checks it actually works,
 * so a misconfigured key surfaces at boot rather than on a user's first claim.
 * Non-fatal: the app still starts so the misconfiguration can be read on screen.
 */
export async function logAdminIdentity(options: ApiOptions): Promise<void> {
  const tag = '[admin-provisioning]'
  if (!options.adminNsec) {
    console.warn(
      `${tag} no LAWALLET_ADMIN_NSEC set — provisioning is disabled (copy .env.example to .env)`
    )
    return
  }

  const admin = createAdminClient({
    endpoint: options.endpoint,
    nsec: options.adminNsec,
    authMode: options.authMode
  })

  try {
    const npub = await admin.npub()
    const client = await admin.get()
    await client.addresses.list()
    console.log(
      `${tag} ${options.endpoint} · auth ${admin.authMode} · admin ${npub.slice(0, 12)}… · credential ok`
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(
      `${tag} credential check failed against ${options.endpoint}: ${detail}\n` +
        `${tag} is that key an ADMIN/OPERATOR on this instance, and does LAWALLET_ENDPOINT match its public URL?`
    )
  }
}

async function readJson(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new LaWalletError(400, 'Body must be JSON', 'INVALID_JSON')
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
