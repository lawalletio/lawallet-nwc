import { describe, it, expect } from 'vitest'
import {
  classifyRow,
  makeConflict,
  tableNoun,
  type TableContext,
} from '@/lib/backup/classify'
import { TABLE_DESCRIPTORS, pkKey, fieldsKey } from '@/lib/backup/tables'
import type { BackupTableName } from '@/lib/validation/schemas'

type Row = Record<string, unknown>

/** Empty context: nothing exists in the DB. */
function emptyCtx(): TableContext {
  return {
    existingByPk: new Map(),
    secondaryExisting: new Map(),
    partialExisting: new Map(),
  }
}

/** By default every FK target is considered available. */
const parentAvailable = () => true
const parentMissing = () => false

describe('backup classify', () => {
  describe('tableNoun', () => {
    it('returns a friendly singular noun per table', () => {
      expect(tableNoun('users')).toBe('user')
      expect(tableNoun('lightningAddresses')).toBe('lightning address')
    })
  })

  describe('makeConflict', () => {
    it('builds a stable id from table + rowKey', () => {
      const conflict = makeConflict(TABLE_DESCRIPTORS.users, 'u1', {
        kind: 'pk',
        message: 'clash',
        allowedStrategies: ['skip'],
        suggestedStrategy: 'skip',
      })
      expect(conflict.id).toBe('users:u1')
      expect(conflict.table).toBe('users')
      expect(conflict.rowKey).toBe('u1')
    })
  })

  describe('classifyRow', () => {
    it('classifies a brand-new row with no collisions as "new"', () => {
      const desc = TABLE_DESCRIPTORS.users
      const row = { id: 'u1', pubkey: 'p1', userId: undefined }
      const result = classifyRow(desc, row, emptyCtx(), parentAvailable)
      expect(result.status).toBe('new')
      expect(result.conflict).toBeUndefined()
    })

    it('classifies an existing equal row as "identical"', () => {
      const desc = TABLE_DESCRIPTORS.settings
      const row = {
        name: 'domain',
        value: 'example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const ctx = emptyCtx()
      // Existing stored with Date objects — rowsEqual normalizes Date vs ISO.
      ctx.existingByPk.set(pkKey(desc, row), {
        ...row,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      })
      const result = classifyRow(desc, row, ctx, parentAvailable)
      expect(result.status).toBe('identical')
    })

    it('flags a PK that exists with different data as conflicting kind "pk"', () => {
      const desc = TABLE_DESCRIPTORS.settings
      const row = { name: 'domain', value: 'new.example.com' }
      const ctx = emptyCtx()
      ctx.existingByPk.set(pkKey(desc, row), { name: 'domain', value: 'old.example.com' })
      const result = classifyRow(desc, row, ctx, parentAvailable)
      expect(result.status).toBe('conflicting')
      expect(result.conflict?.kind).toBe('pk')
      expect(result.conflict?.allowedStrategies).toEqual(['skip', 'overwrite'])
    })

    it('suggests "rename" for a lightningAddresses PK owned by a different userId', () => {
      const desc = TABLE_DESCRIPTORS.lightningAddresses
      const row = {
        username: 'satoshi',
        userId: 'user-A',
        mode: 'IDLE',
        redirect: null,
        remoteWalletId: null,
        isPrimary: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const ctx = emptyCtx()
      ctx.existingByPk.set(pkKey(desc, row), { ...row, userId: 'user-B' })
      const result = classifyRow(desc, row, ctx, parentAvailable)
      expect(result.status).toBe('conflicting')
      expect(result.conflict?.kind).toBe('pk')
      expect(result.conflict?.suggestedStrategy).toBe('rename')
      // rename is only an allowed strategy for tables with a renameField.
      expect(result.conflict?.allowedStrategies).toContain('rename')
      expect(result.conflict?.existingOwnerId).toBe('user-B')
    })

    it('flags a users row whose pubkey collides on a different id as "secondary-unique"', () => {
      const desc = TABLE_DESCRIPTORS.users
      const row = { id: 'user-new', pubkey: 'shared-pubkey' }
      const su = desc.secondaryUniques[0] // { fields: ['pubkey'], label: 'Nostr identity' }
      const ctx = emptyCtx()
      const inner = new Map<string, Row>()
      inner.set(fieldsKey(su.fields, row), { id: 'user-existing', pubkey: 'shared-pubkey' })
      ctx.secondaryExisting.set(su.label, inner)
      const result = classifyRow(desc, row, ctx, parentAvailable)
      expect(result.status).toBe('conflicting')
      expect(result.conflict?.kind).toBe('secondary-unique')
      expect(result.conflict?.field).toBe('pubkey')
      expect(result.conflict?.existingId).toBe('user-existing')
      // users has no renameField → only skip is allowed.
      expect(result.conflict?.allowedStrategies).toEqual(['skip'])
    })

    it('flags a cards row whose required designId is unavailable as "fk-target-missing"', () => {
      const desc = TABLE_DESCRIPTORS.cards
      const row = {
        id: 'card-1',
        designId: 'design-gone',
        ntag424Cid: null,
        userId: null,
        remoteWalletId: null,
        username: null,
        kind: 'SIMPLE',
      }
      // designId is a required FK to cardDesigns; parentMissing → not available.
      const result = classifyRow(desc, row, emptyCtx(), parentMissing)
      expect(result.status).toBe('conflicting')
      expect(result.conflict?.kind).toBe('fk-target-missing')
      expect(result.conflict?.field).toBe('designId')
      expect(result.conflict?.allowedStrategies).toEqual(['skip'])
    })

    it('does not flag fk-target-missing when the required target is available', () => {
      const desc = TABLE_DESCRIPTORS.cards
      const row = {
        id: 'card-1',
        designId: 'design-present',
        ntag424Cid: null,
        userId: null,
        remoteWalletId: null,
        username: null,
        kind: 'SIMPLE',
      }
      const result = classifyRow(desc, row, emptyCtx(), parentAvailable)
      expect(result.status).toBe('new')
    })

    it('flags a partial-unique clash (primary address on a different row)', () => {
      const desc = TABLE_DESCRIPTORS.lightningAddresses
      const row = {
        username: 'primary-new',
        userId: 'user-A',
        mode: 'IDLE',
        redirect: null,
        remoteWalletId: null,
        isPrimary: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const pu = desc.partialUniques[0] // { label: 'primary address', scope: ['userId'], flag: 'isPrimary' }
      const ctx = emptyCtx()
      const inner = new Map<string, Row>()
      inner.set(fieldsKey(pu.scope, row), { username: 'primary-existing', userId: 'user-A' })
      ctx.partialExisting.set(pu.label, inner)
      const result = classifyRow(desc, row, ctx, parentAvailable)
      expect(result.status).toBe('conflicting')
      expect(result.conflict?.kind).toBe('partial-unique')
      expect(result.conflict?.field).toBe('isPrimary')
      expect(result.conflict?.allowedStrategies).toEqual(['skip', 'overwrite'])
    })
  })
})
