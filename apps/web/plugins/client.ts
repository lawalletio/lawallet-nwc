'use client'

/**
 * Client-side plugin entry point — UI contributions (nav items, pages).
 * Imported by the admin sidebar and the plugin page host. Keep this file
 * free of server imports; plugin UI registers here, one line per plugin.
 */
import { registerPluginClient } from './_runtime/client-registry'
import { badgesPluginClient } from './badges/client'

registerPluginClient(badgesPluginClient)

export {
  registerPluginClient,
  getPluginClient,
  listPluginClients,
  pluginNavItems
} from './_runtime/client-registry'
export type {
  LawalletPluginClient,
  PluginNavItem
} from './_runtime/client-registry'
