import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  registerPlugin,
  unregisterPlugin,
  getPlugin,
  listPlugins
} from '@/plugins/_runtime/registry'
import {
  isPluginEnabled,
  listPluginStates,
  setPluginEnabled
} from '@/plugins/_runtime/loader'
import { dispatchHook } from '@/plugins/_runtime/hooks'
import { putRecord, getRecord, listRecords } from '@/plugins/_runtime/records'
import type { LawalletPlugin } from '@/plugins/_runtime/types'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    isProduction: false,
    logging: { level: 'silent', pretty: false }
  }))
}))

function makePlugin(overrides: Partial<LawalletPlugin> = {}): LawalletPlugin {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '0.0.1',
    configSchema: z.object({}).strict(),
    ...overrides
  }
}

const settingsRows = (rows: Array<{ name: string; value: string }>) => {
  ;(prismaMock.settings.findMany as any).mockResolvedValue(rows)
}

beforeEach(() => {
  resetPrismaMock()
  unregisterPlugin('test-plugin')
  unregisterPlugin('other-plugin')
})

describe('registry', () => {
  it('registers and looks up a plugin', () => {
    const plugin = makePlugin()
    registerPlugin(plugin)
    expect(getPlugin('test-plugin')).toBe(plugin)
    expect(listPlugins().some(p => p.id === 'test-plugin')).toBe(true)
  })

  it('is idempotent — re-registering overwrites', () => {
    registerPlugin(makePlugin({ version: '1.0.0' }))
    registerPlugin(makePlugin({ version: '2.0.0' }))
    expect(getPlugin('test-plugin')?.version).toBe('2.0.0')
  })

  it('rejects invalid ids', () => {
    expect(() => registerPlugin(makePlugin({ id: 'Bad_Id' }))).toThrow(
      /Invalid plugin id/
    )
  })
})

describe('loader', () => {
  it('resolves defaultEnabled when no setting is stored', async () => {
    registerPlugin(makePlugin({ defaultEnabled: true }))
    settingsRows([])
    expect(await isPluginEnabled('test-plugin')).toBe(true)
  })

  it('defaults to disabled without defaultEnabled', async () => {
    registerPlugin(makePlugin())
    settingsRows([])
    expect(await isPluginEnabled('test-plugin')).toBe(false)
  })

  it('stored setting wins over defaultEnabled', async () => {
    registerPlugin(makePlugin({ defaultEnabled: true }))
    settingsRows([{ name: 'plugin.test-plugin.enabled', value: 'false' }])
    expect(await isPluginEnabled('test-plugin')).toBe(false)
  })

  it('listPluginStates reports every registered plugin', async () => {
    registerPlugin(makePlugin())
    settingsRows([{ name: 'plugin.test-plugin.enabled', value: 'true' }])
    const states = await listPluginStates()
    const state = states.find(s => s.id === 'test-plugin')
    expect(state).toMatchObject({ id: 'test-plugin', enabled: true })
  })

  it('setPluginEnabled upserts the setting and runs migrate on enable', async () => {
    const migrate = vi.fn()
    registerPlugin(makePlugin({ migrate }))
    ;(prismaMock.settings.upsert as any).mockResolvedValue({})

    await setPluginEnabled('test-plugin', true)

    expect(prismaMock.settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'plugin.test-plugin.enabled' }
      })
    )
    expect(migrate).toHaveBeenCalledTimes(1)

    await setPluginEnabled('test-plugin', false)
    expect(migrate).toHaveBeenCalledTimes(1) // not on disable
  })

  it('setPluginEnabled throws for unknown plugins', async () => {
    await expect(setPluginEnabled('nope', true)).rejects.toThrow(
      /Unknown plugin/
    )
  })
})

describe('hooks', () => {
  it('dispatches to enabled plugins that subscribe', async () => {
    const handler = vi.fn()
    registerPlugin(
      makePlugin({ hooks: { 'plugin:toggled': handler }, defaultEnabled: true })
    )
    settingsRows([])

    await dispatchHook('plugin:toggled', { pluginId: 'x', enabled: true })

    expect(handler).toHaveBeenCalledWith({ pluginId: 'x', enabled: true })
  })

  it('skips disabled plugins', async () => {
    const handler = vi.fn()
    registerPlugin(makePlugin({ hooks: { 'plugin:toggled': handler } }))
    settingsRows([]) // not enabled, no defaultEnabled

    await dispatchHook('plugin:toggled', { pluginId: 'x', enabled: true })

    expect(handler).not.toHaveBeenCalled()
  })

  it('a throwing handler never propagates', async () => {
    registerPlugin(
      makePlugin({
        defaultEnabled: true,
        hooks: {
          'plugin:toggled': () => {
            throw new Error('plugin bug')
          }
        }
      })
    )
    settingsRows([])

    await expect(
      dispatchHook('plugin:toggled', { pluginId: 'x', enabled: true })
    ).resolves.toBeUndefined()
  })
})

describe('records', () => {
  const schema = z.object({ label: z.string() })

  it('putRecord validates and upserts', async () => {
    ;(prismaMock.pluginRecord.upsert as any).mockResolvedValue({})

    await putRecord('test-plugin', 'item', 'a', schema, { label: 'hi' })

    expect(prismaMock.pluginRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pluginId_kind_key: { pluginId: 'test-plugin', kind: 'item', key: 'a' }
        }
      })
    )
  })

  it('putRecord rejects invalid data', async () => {
    await expect(
      putRecord('test-plugin', 'item', 'a', schema, { label: 1 } as any)
    ).rejects.toThrow()
    expect(prismaMock.pluginRecord.upsert).not.toHaveBeenCalled()
  })

  it('getRecord returns null on schema mismatch (corrupt row)', async () => {
    ;(prismaMock.pluginRecord.findUnique as any).mockResolvedValue({
      data: { wrong: true }
    })
    expect(await getRecord('test-plugin', 'item', 'a', schema)).toBeNull()
  })

  it('listRecords filters out corrupt rows', async () => {
    ;(prismaMock.pluginRecord.findMany as any).mockResolvedValue([
      { key: 'good', data: { label: 'ok' } },
      { key: 'bad', data: { nope: 1 } }
    ])
    const rows = await listRecords('test-plugin', 'item', schema)
    expect(rows).toEqual([{ key: 'good', data: { label: 'ok' } }])
  })
})
