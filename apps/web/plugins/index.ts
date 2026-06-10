/**
 * Server-side plugin entry point. Importing this file once (the core
 * /api/plugins routes and hook emit sites do) registers every built-in
 * plugin — the exact pattern of `lib/wallet/drivers/index.ts`.
 *
 * Adding a plugin = its own directory + ONE line here (and one in
 * client.ts if it ships UI). Nothing else in core changes.
 */
import { registerPlugin } from './_runtime/registry'
import { badgesPlugin } from './badges/plugin'

registerPlugin(badgesPlugin)

export * from './_runtime/types'
export {
  registerPlugin,
  unregisterPlugin,
  getPlugin,
  listPlugins
} from './_runtime/registry'
export {
  isPluginEnabled,
  listPluginStates,
  enabledPlugins,
  setPluginEnabled
} from './_runtime/loader'
export { dispatchHook, dispatchHookAndForget } from './_runtime/hooks'
export {
  putRecord,
  getRecord,
  listRecords,
  deleteRecord
} from './_runtime/records'
