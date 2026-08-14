import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import {
  createNip98Token,
  generateSigner,
  nsecSigner,
  toNpub
} from '@lawallet-nwc/sdk'

/**
 * Getting an admin key without a setup ritual.
 *
 * Provisioning needs a key that holds `addresses:write` on the instance. When
 * `LAWALLET_ADMIN_NSEC` is missing we generate one and persist it to `.env`
 * (gitignored) so it survives restarts, then try to grant it the role:
 *
 * - Instance with no root yet → `POST /api/admin/assign` makes this key the
 *   root ADMIN. Nothing else to do; the example just works.
 * - Instance that already has a root → we cannot self-promote, so we print
 *   exactly what the operator has to run.
 */

const KEY = 'LAWALLET_ADMIN_NSEC'
const TAG = '[admin-provisioning]'

/** Returns the configured admin nsec, generating and persisting one if absent. */
export function ensureAdminNsec(
  env: Record<string, string | undefined>,
  envPath: string
): { nsec: string; generated: boolean } {
  const existing = env[KEY]?.trim()
  if (existing) return { nsec: existing, generated: false }

  const { nsec, npub } = generateSigner()

  // Never clobber an existing file — append, and only when the key is absent.
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  if (!new RegExp(`^${KEY}=`, 'm').test(current)) {
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    appendFileSync(
      envPath,
      `${prefix}# Generated automatically on first run.\n${KEY}=${nsec}\n`
    )
  }

  console.log(`${TAG} no ${KEY} found — generated one and wrote it to .env`)
  console.log(`${TAG} admin identity: ${npub}`)
  return { nsec, generated: true }
}

/**
 * Makes sure the key can actually provision, bootstrapping the role when the
 * instance allows it. Never throws: a misconfigured instance should still let
 * the app start so the reason is readable on screen.
 */
export async function ensureAdminRole(
  endpoint: string,
  nsec: string
): Promise<void> {
  const signer = nsecSigner(nsec)
  const npub = toNpub(await signer.getPublicKey())

  try {
    // Materialise the account first. A key the instance has never seen has no
    // User row, and you cannot grant a role to a row that doesn't exist — so
    // without this the operator would have nothing to promote.
    const { LaWalletClient } = await import('@lawallet-nwc/sdk')
    await new LaWalletClient({ endpoint, signer }).users.me()

    const status = await fetch(`${endpoint}/api/setup/status`).then(r =>
      r.json()
    )
    if (status?.hasRoot) return // someone already owns this instance

    // Fresh instance: whoever asks first becomes root. That is the documented
    // bootstrap trapdoor, and it makes this example self-provisioning.
    const url = `${endpoint}/api/admin/assign`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: await createNip98Token(url, { method: 'POST' }, signer)
      }
    })
    if (res.ok) {
      console.log(`${TAG} instance had no root — claimed it for ${npub}`)
    }
  } catch {
    // Instance unreachable; the credential check that follows reports it.
  }
}

/** The manual grant, printed when we could not do it ourselves. */
export function promotionInstructions(npub: string, pubkey: string): string {
  return [
    `${TAG} ${npub} is not an admin on this instance yet.`,
    `${TAG} Grant it from the instance (Admin → Users), or directly:`,
    `${TAG}   UPDATE "User" SET role='ADMIN' WHERE pubkey='${pubkey}';`,
    `${TAG} The role is read per request, so no restart is needed.`
  ].join('\n')
}
