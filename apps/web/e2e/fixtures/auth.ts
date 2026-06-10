import { test as base, type Page } from '@playwright/test'
import { createJwtToken } from '../../lib/jwt'
import { Role, getRolePermissions } from '../../lib/auth/permissions'
import { E2E_JWT_SECRET } from '../env'

/**
 * Auth fixtures that mint session JWTs directly — same shape as
 * `POST /api/jwt` (claims: userId/pubkey/role/permissions; issuer
 * `lawallet-nwc`, audience `lawallet-users`) and signed with the exact
 * JWT_SECRET the webServer is launched with. This skips the NIP-98 signing
 * dance while still exercising the server's real JWT verification path.
 *
 * The web client keeps its session in localStorage under `lawallet-jwt`
 * (components/admin/auth-context.tsx) and sends it as a Bearer header
 * (lib/client/api-client.ts), so injecting the token before page load is a
 * faithful logged-in state.
 */

// Seeded identities — fixed pubkeys from apps/web/mocks/user.ts, inserted by
// the deterministic seed in global-setup.
export const SEEDED_ADMIN_PUBKEY =
  'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890'
export const SEEDED_USER_PUBKEY =
  'npub1abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123'

export function mintSessionToken(pubkey: string, role: Role): string {
  return createJwtToken(
    {
      userId: pubkey,
      pubkey,
      role,
      permissions: getRolePermissions(role)
    },
    E2E_JWT_SECRET,
    {
      expiresIn: '1h',
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }
  )
}

async function loginAs(page: Page, pubkey: string, role: Role) {
  const token = mintSessionToken(pubkey, role)
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value)
    },
    ['lawallet-jwt', token] as const
  )
}

interface AuthFixtures {
  /** Page pre-authenticated as a seeded ADMIN. */
  adminPage: Page
  /** Page pre-authenticated as a seeded plain USER. */
  userPage: Page
}

export const test = base.extend<AuthFixtures>({
  // The fixture callback's second argument is conventionally named `use`,
  // but that trips eslint's react-hooks rule — `provide` is the same thing.
  adminPage: async ({ page }, provide) => {
    await loginAs(page, SEEDED_ADMIN_PUBKEY, Role.ADMIN)
    await provide(page)
  },
  userPage: async ({ page }, provide) => {
    await loginAs(page, SEEDED_USER_PUBKEY, Role.USER)
    await provide(page)
  }
})

export { expect } from '@playwright/test'
