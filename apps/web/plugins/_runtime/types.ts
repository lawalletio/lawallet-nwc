import type { z } from 'zod'
import type { NextRequest } from 'next/server'

/**
 * In-codebase plugin system — server-side manifest types.
 *
 * Structural clone of the proven wallet-driver pattern
 * (`lib/wallet/drivers/types.ts`): a readonly string discriminator, a Zod
 * `configSchema` validating JSON config, and optional capabilities a plugin
 * opts into. Unlike drivers, the discriminator is a plain string — never a
 * Prisma enum — so adding a plugin requires zero migrations and produces
 * zero merge conflicts in core (see docs/PLUGINS.md for the rules).
 *
 * Client-side contributions (nav items, pages) live in a separate
 * `client.tsx` manifest registered via `_runtime/client-registry.ts`, so
 * server-only code (Prisma, hooks) never leaks into the client bundle.
 */

/** Payloads for lifecycle hooks plugins can subscribe to. */
export interface PluginHookPayloads {
  /** An invoice transitioned to PAID. */
  'invoice:paid': {
    invoiceId: string
    paymentHash: string
    amountSats: number
    purpose: string
    userId: string
  }
  /** A plugin was enabled or disabled by an admin. */
  'plugin:toggled': {
    pluginId: string
    enabled: boolean
  }
}

export type PluginHookName = keyof PluginHookPayloads

export type PluginHookHandler<N extends PluginHookName = PluginHookName> = (
  payload: PluginHookPayloads[N]
) => Promise<void> | void

/**
 * Request context handed to a plugin's route handler by the core catch-all
 * (`app/api/plugins/[plugin]/[...path]/route.ts`). The plugin owns its
 * sub-paths under `/api/plugins/<id>/...` — auth is the plugin's job, using
 * the same helpers core routes use (`lib/auth/unified-auth.ts`).
 */
export interface PluginRouteContext {
  /** Uppercase HTTP method. */
  method: string
  /** Path segments after `/api/plugins/<id>/`. */
  path: string[]
}

export type PluginRouteHandler = (
  request: NextRequest,
  ctx: PluginRouteContext
) => Promise<Response>

export interface LawalletPlugin<TConfig = unknown> {
  /** Stable slug (^[a-z][a-z0-9-]*$) — Settings key + URL namespace. */
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string

  /**
   * Validates this plugin's config JSON (stored as a PluginRecord with
   * kind 'config'). Use `.default()`s so an absent config still parses.
   */
  readonly configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>

  /** Enabled before an admin ever touches the toggle. Defaults to false. */
  readonly defaultEnabled?: boolean

  /** Handles requests under /api/plugins/<id>/** when enabled. */
  readonly routes?: PluginRouteHandler

  /** Lifecycle subscriptions, dispatched via `_runtime/hooks.ts`. */
  readonly hooks?: {
    [N in PluginHookName]?: PluginHookHandler<N>
  }

  /** Idempotent setup run when the plugin is enabled. */
  readonly migrate?: () => Promise<void>
}

/** Enabled-state row served by GET /api/plugins. */
export interface PluginState {
  id: string
  name: string
  version: string
  description?: string
  enabled: boolean
}
