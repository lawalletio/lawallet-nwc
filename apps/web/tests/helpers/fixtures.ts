import { faker } from '@faker-js/faker'

// ── User Fixtures ───────────────────────────────────────────────────────────

export function createUserFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: faker.string.uuid(),
    pubkey: faker.string.hexadecimal({ length: 64, prefix: '' }),
    nwc: null,
    role: 'USER' as const,
    createdAt: faker.date.past(),
    // Default to "no primary NWC connection" so callers of /api/users/me and
    // similar routes that now `include: { nwcConnections: { where: { isPrimary: true } } }`
    // don't crash with `user.nwcConnections is undefined`. Tests that care
    // about a present primary connection override this explicitly.
    nwcConnections: [],
    ...overrides,
  }
}

export function createAdminUserFixture(overrides: Record<string, unknown> = {}) {
  return createUserFixture({ role: 'ADMIN', ...overrides })
}

// ── Card Fixtures ───────────────────────────────────────────────────────────

export function createCardFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: faker.string.hexadecimal({ length: 32, prefix: '' }),
    designId: faker.string.uuid(),
    title: faker.commerce.productName(),
    createdAt: faker.date.past(),
    lastUsedAt: null,
    username: null,
    otc: faker.string.hexadecimal({ length: 32, prefix: '' }),
    ntag424Cid: faker.string.hexadecimal({ length: 14, prefix: '' }),
    ...overrides,
  }
}

// ── Card Design Fixtures ────────────────────────────────────────────────────

export function createCardDesignFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: faker.string.uuid(),
    imageUrl: faker.image.url(),
    description: faker.lorem.sentence(),
    createdAt: faker.date.past(),
    ...overrides,
  }
}

// ── Lightning Address Fixtures ──────────────────────────────────────────────

export function createLightningAddressFixture(overrides: Record<string, unknown> = {}) {
  return {
    username: faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, ''),
    userId: faker.string.uuid(),
    createdAt: faker.date.past(),
    ...overrides,
  }
}

// ── Settings Fixtures ───────────────────────────────────────────────────────

export function createSettingsFixture(overrides: Record<string, unknown> = {}) {
  return {
    name: faker.string.alpha({ length: 10 }),
    value: faker.string.alpha({ length: 20 }),
    ...overrides,
  }
}

// ── NTAG424 Fixtures ────────────────────────────────────────────────────────

export function createNtag424Fixture(overrides: Record<string, unknown> = {}) {
  return {
    cid: faker.string.hexadecimal({ length: 14, prefix: '' }),
    k0: faker.string.hexadecimal({ length: 32, prefix: '' }),
    k1: faker.string.hexadecimal({ length: 32, prefix: '' }),
    k2: faker.string.hexadecimal({ length: 32, prefix: '' }),
    k3: faker.string.hexadecimal({ length: 32, prefix: '' }),
    k4: faker.string.hexadecimal({ length: 32, prefix: '' }),
    ctr: 0,
    createdAt: faker.date.past(),
    ...overrides,
  }
}
