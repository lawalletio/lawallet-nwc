'use client'

import type { ComponentType } from 'react'
import type { Permission } from '@/lib/auth/permissions'

/**
 * Client-side plugin registry — UI contributions only. Kept separate from
 * the server registry so plugin server code (Prisma, hooks) never enters
 * the client bundle. Plugins register here via `plugins/client.ts`.
 */

export interface PluginNavItem {
  title: string
  /** Usually `/admin/plugins/<id>` — served by the core plugin page host. */
  href: string
  icon: ComponentType<{ className?: string }>
  /** Optional RBAC gate — reuses the sidebar's existing permission filter. */
  permission?: Permission
  /** Which sidebar group to join. */
  group: 'platform' | 'system'
}

export interface LawalletPluginClient {
  /** Must match the server manifest's id. */
  readonly id: string
  readonly navItems?: PluginNavItem[]
  /** Rendered at /admin/plugins/<id> by the core page host. */
  readonly Page?: ComponentType
}

const registry = new Map<string, LawalletPluginClient>()

export function registerPluginClient(plugin: LawalletPluginClient): void {
  registry.set(plugin.id, plugin)
}

export function getPluginClient(id: string): LawalletPluginClient | undefined {
  return registry.get(id)
}

export function listPluginClients(): LawalletPluginClient[] {
  return [...registry.values()]
}

/** Nav items contributed by the given plugins (typically the enabled ones). */
export function pluginNavItems(
  group: 'platform' | 'system',
  enabledIds: Set<string>
): PluginNavItem[] {
  return listPluginClients()
    .filter(p => enabledIds.has(p.id))
    .flatMap(p => p.navItems ?? [])
    .filter(item => item.group === group)
}
