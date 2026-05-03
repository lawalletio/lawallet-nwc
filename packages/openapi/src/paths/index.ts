// Side-effect imports: each module calls `registry.registerPath()` for its
// resource group. Keep this file a flat list; ordering doesn't matter because
// path registration is independent across files.
import './auth'
import './cards'
import './card-designs'
import './lightning-addresses'
import './lud16'
import './wallet'
import './users'
import './invoices'
import './settings'
import './admin'
import './root'
import './setup'
import './remote-connections'
import './activity'
import './events'
