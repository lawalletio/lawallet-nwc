import { common } from './common'
import { settings } from './settings'
import { home } from './home'
import { activity } from './activity'
import { shared } from './shared'
import { send } from './send'
import { scan } from './scan'
import { withdraw } from './withdraw'
import { receive } from './receive'
import { claim } from './claim'
import { addresses } from './addresses'
import { remoteWallets } from './remoteWallets'
import { onboarding } from './onboarding'
import { activate } from './activate'
import { auth } from './auth'

const en = {
  common,
  settings,
  home,
  activity,
  shared,
  send,
  scan,
  withdraw,
  receive,
  claim,
  addresses,
  remoteWallets,
  onboarding,
  activate,
  auth
}

/** Every locale must match this shape — `tsc` flags missing or extra keys. */
export type Dict = typeof en

export default en
