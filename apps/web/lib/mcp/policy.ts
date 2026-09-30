import type { CatalogOperation } from '@/lib/mcp/catalog'

/**
 * Which REST operations an MCP client may reach, and with which scope.
 *
 * Every operation that survives the structural rules below is listed in
 * {@link OPERATION_POLICY} on purpose — a unit test fails when the OpenAPI
 * document gains an operation this table does not classify, so a new endpoint
 * is never exposed by default. `read` operations need the `read` scope and
 * `write` operations the `write` scope (public operations need none).
 *
 * Spending exists only in the native `wallet_pay_invoice` tool, which enforces
 * the grant's daily budget. So every operation that moves funds out of a
 * wallet, or changes where incoming funds are delivered or forwarded, is
 * excluded here — an agent that could repoint an address could take future
 * payments without ever touching that budget.
 */

export type OperationAccess = 'read' | 'write'

export type OperationPolicy = { access: OperationAccess } | { excluded: string }

const READ = { access: 'read' } as const
const WRITE = { access: 'write' } as const
const exclude = (reason: string): OperationPolicy => ({ excluded: reason })

const MOVES_FUNDS =
  'moves funds out of a wallet; spending only goes through wallet_pay_invoice and its budget'
const AUTO_FORWARD =
  'configures auto-forwarding of received funds to another destination'
const TOKEN_PLUMBING = 'session-token plumbing, not an account operation'
const WEBAUTHN = 'WebAuthn ceremony that needs the user’s own authenticator'
const IDENTITY =
  'account-security change: linking, merging or removing Nostr identities needs the user’s own keys'
const CARD_PROTOCOL =
  'BoltCard protocol endpoint, called by the card or a paying wallet'
const DOMAIN_SETUP =
  'domain-verification callback for instance setup, not an agent operation'
const DEVICE_PAIRING =
  'device pairing: the external device key in the path is a bearer credential'

/** Explicit classification of every non-structural operation, by operationId. */
export const OPERATION_POLICY: Record<string, OperationPolicy> = {
  // Auth
  'auth.validate': exclude(TOKEN_PLUMBING),
  'auth.qrJwt.generate': exclude(
    'mints a device JWT; credential minting stays with the signed-in user'
  ),
  'auth.protected.get': exclude(TOKEN_PLUMBING),
  'auth.protected.post': exclude(TOKEN_PLUMBING),

  // Passkeys
  'passkey.registration.options': exclude(WEBAUTHN),
  'passkey.registration.verify': exclude(WEBAUTHN),
  'passkey.credentials.list': READ,
  'passkey.credentials.update': exclude(
    'account-security change: edits a passkey that signs in to this account'
  ),
  'passkey.credentials.delete': exclude(
    'account-security change: removes a passkey that signs in to this account'
  ),

  // Account
  'account.get': READ,
  'account.link.begin': exclude(IDENTITY),
  'account.link.verify': exclude(IDENTITY),
  'account.merge.preview': exclude(IDENTITY),
  'account.merge': exclude(IDENTITY),
  'account.identities.update': exclude(IDENTITY),
  'account.identities.delete': exclude(IDENTITY),

  // Cards
  'cards.list': READ,
  'cards.create': WRITE,
  'cards.counts': READ,
  'cards.get': READ,
  'cards.update': WRITE,
  'cards.delete': WRITE,
  'cards.transactions.list': READ,
  'cards.write': exclude(
    'card programming: returns the card’s NTAG424 keys to the writer app'
  ),
  'cards.writeToken': exclude(
    'card programming: mints the token the writer app redeems for card keys'
  ),
  'cards.wipe': exclude(
    'card programming: exports the card’s reset keys and blocks it'
  ),
  'cards.emulateTap': exclude(
    'signs a card tap, which authorizes a payment from the card’s wallet'
  ),
  'cards.scan': exclude(CARD_PROTOCOL),
  'cards.scan.callback': exclude(
    'pays an invoice from the card’s wallet (LNURL-withdraw callback)'
  ),
  'cards.lnurlp': exclude(CARD_PROTOCOL),
  'cards.lnurlp.callback': exclude(CARD_PROTOCOL),
  'cards.otc.get': exclude(
    'the one-time code in the path is a bearer credential for claiming the card'
  ),
  'cards.otc.activate': WRITE,
  'cards.activationTokens.create': WRITE,
  'cards.activationTokens.list': READ,
  'cards.rescue': WRITE,
  'activationTokens.preview': READ,
  'activationTokens.claim': WRITE,

  // Card designs
  'cardDesigns.create': WRITE,
  'cardDesigns.list': READ,
  'cardDesigns.count': READ,
  'cardDesigns.update': WRITE,
  'cardDesigns.import': WRITE,

  // Lightning addresses (admin inventory)
  'lightningAddresses.list': READ,
  'lightningAddresses.provision': WRITE,
  'lightningAddresses.check': READ,
  'lightningAddresses.counts': READ,
  'lightningAddresses.verifyProtocols': WRITE,

  // LUD-16
  'lud16.payRequest': READ,
  // A GET, but it mints an invoice — that is a write in MCP terms.
  'lud16.callback': WRITE,
  'lud16.callbackAction': exclude(
    'LUD-16 protocol endpoint where another server delivers a voucher'
  ),
  'lud16.verify': READ,

  // Wallet
  'wallet.addresses.list': READ,
  'wallet.addresses.create': WRITE,
  'wallet.addresses.proxyBalance.get': READ,
  'wallet.addresses.proxyBalance.forward': exclude(MOVES_FUNDS),
  'wallet.cards.list': READ,
  'wallet.addresses.invoices.forwarding.recover': exclude(
    'retries or re-targets the forwarding payment of a received invoice'
  ),
  'wallet.cards.update': WRITE,
  // A POST, but it only probes the target address.
  'wallet.addresses.probeAlias': READ,
  'wallet.addresses.get': READ,
  'wallet.addresses.update': exclude(
    'repoints the address: ALIAS and PROXY_ALIAS forward its incoming payments to any external lightning address'
  ),
  'wallet.addresses.delete': WRITE,
  'wallet.addresses.setPrimary': WRITE,
  'wallet.addresses.invoices': READ,

  // Users
  'users.list': READ,
  'users.me': READ,
  'users.me.currencyPrefs.set': WRITE,
  'users.get': READ,
  'users.cards.list': READ,
  'users.role.get': READ,
  'users.role.set': exclude(
    'privilege change: a new role hands another pubkey the settings and fund-routing powers withheld here'
  ),
  'users.relays.set': WRITE,
  'users.lightningAddress.set': WRITE,

  // Invoices
  'invoices.create': WRITE,
  'invoices.claim': WRITE,

  // Settings
  'settings.get': READ,
  'settings.update': exclude(
    'writes any instance setting, including the root admin, the listener signing secret and payment destinations'
  ),
  'settings.domainProbe': exclude(
    'makes the server fetch a caller-supplied domain (localhost included) and overwrites the instance’s domain_verified setting'
  ),
  'settings.listenerProbe': exclude(
    'sends the stored listener secret (by default the one that signs payment webhooks) to a caller-supplied URL'
  ),

  // Plugins
  'plugins.list': READ,
  'plugins.update': exclude(
    'instance control: enables or disables a plugin for every user and runs its setup migration'
  ),

  // Setup
  'setup.status': READ,
  'setup.verify.get': exclude(DOMAIN_SETUP),
  'setup.verify.post': exclude(DOMAIN_SETUP),

  // Version
  'version.get': READ,

  // Health
  'health.get': READ,

  // Remote connections
  'remoteConnections.get': exclude(DEVICE_PAIRING),
  'remoteConnections.cards.create': exclude(DEVICE_PAIRING),

  // Remote wallets
  'remoteWallets.list': READ,
  'remoteWallets.create': exclude(
    'registers any external wallet and can bind the primary address to it (isDefault), redirecting incoming payments'
  ),
  'remoteWallets.receiveAction.get': READ,
  'remoteWallets.receiveAction.configure': exclude(AUTO_FORWARD),
  'remoteWallets.receiveAction.toggle': exclude(AUTO_FORWARD),
  'remoteWallets.forwardingActivity.list': READ,
  'remoteWallets.receiveAction.force': exclude(MOVES_FUNDS),
  'remoteWallets.forwardingReceipts.list': READ,
  'remoteWallets.forwardingReceipts.get': READ,
  'remoteWallets.forwardingReceipts.retry': exclude(MOVES_FUNDS),
  'remoteWallets.notifications.list': READ,
  'remoteWallets.notifications.create': WRITE,
  'remoteWallets.notifications.toggle': WRITE,
  'remoteWallets.notificationDeliveries.list': READ,
  'remoteWallets.notificationDeliveries.retry': WRITE,
  'remoteWallets.payments.zapAudit': READ,
  'remoteWallets.forwardingMap.list': READ,
  'remoteWallets.createLncurl': WRITE,
  'remoteWallets.get': READ,
  'remoteWallets.update': WRITE,
  'remoteWallets.delete': WRITE,

  // Activity
  'activity.list': READ,
  'admin.listener.status': READ,

  // LUD-16 proxy
  'lud16Proxy.config.get': READ,
  'lud16Proxy.config.update': exclude(
    'replaces the proxy wallet that holds and forwards deferred payments, and its receipt-signing key'
  ),
  'lud16Proxy.config.test': exclude(
    'exercises the decrypted proxy-wallet credential against the live wallet'
  ),
  'lud16Proxy.payments.list': READ,
  'lud16Proxy.payments.retry': exclude(MOVES_FUNDS),

  // Nostr
  // A POST, but it only resolves cached profiles.
  'nostr.profiles.resolve': READ,

  // Vouchers
  'vouchers.deposit': WRITE,
  'wallet.vouchers.list': READ,
  'wallet.vouchers.get': READ,
  'wallet.vouchers.delete': WRITE,
  'wallet.vouchers.refresh': WRITE,
  'wallet.vouchers.settings.get': READ,
  'wallet.vouchers.settings.update': WRITE,
  'wallet.vouchers.send': exclude(
    'hands a voucher to another address, an irreversible transfer of value'
  )
}

/**
 * Exclusions that follow from an operation's shape rather than a decision
 * about it. Returns the reason, or null when the table decides.
 */
export function structuralExclusion(op: CatalogOperation): string | null {
  if (op.method === 'OPTIONS') return 'CORS preflight'
  if (op.security === 'other') {
    return 'needs a NIP-98 signature, the listener HMAC or an SSE token — not a Bearer credential'
  }
  return null
}

/** The policy for an operation; an unclassified one is refused (fail closed). */
export function policyFor(op: CatalogOperation): OperationPolicy {
  const structural = structuralExclusion(op)
  if (structural) return exclude(structural)
  return (
    OPERATION_POLICY[op.operationId] ?? exclude('not classified for MCP yet')
  )
}

/** A REST operation offered as a first-class tool with a friendly name. */
export interface PromotedTool {
  name: string
  title: string
  operationId: string
  /** Whether the operation reaches beyond this instance (wallets, other hosts). */
  openWorld: boolean
}

export const PROMOTED_TOOLS: PromotedTool[] = [
  {
    name: 'resolve_lightning_address',
    title: 'Resolve a lightning address',
    operationId: 'lud16.payRequest',
    openWorld: true
  },
  {
    name: 'request_address_invoice',
    title: 'Get an invoice for a lightning address',
    operationId: 'lud16.callback',
    openWorld: true
  },
  {
    name: 'verify_address_payment',
    title: 'Check an address invoice',
    operationId: 'lud16.verify',
    openWorld: true
  },
  {
    name: 'check_address_availability',
    title: 'Check a username',
    operationId: 'lightningAddresses.check',
    openWorld: false
  },
  {
    name: 'get_my_account',
    title: 'My account',
    operationId: 'users.me',
    openWorld: false
  },
  {
    name: 'list_lightning_addresses',
    title: 'My lightning addresses',
    operationId: 'wallet.addresses.list',
    openWorld: false
  },
  {
    name: 'get_lightning_address',
    title: 'Lightning address details',
    operationId: 'wallet.addresses.get',
    openWorld: false
  },
  {
    name: 'list_address_invoices',
    title: 'Address invoices',
    operationId: 'wallet.addresses.invoices',
    openWorld: false
  },
  {
    name: 'list_wallets',
    title: 'My wallets',
    operationId: 'remoteWallets.list',
    openWorld: false
  },
  {
    name: 'list_my_cards',
    title: 'My cards',
    operationId: 'wallet.cards.list',
    openWorld: false
  },
  {
    name: 'list_cards',
    title: 'All cards',
    operationId: 'cards.list',
    openWorld: false
  },
  {
    name: 'get_card',
    title: 'Card details',
    operationId: 'cards.get',
    openWorld: false
  },
  {
    name: 'list_users',
    title: 'Members',
    operationId: 'users.list',
    openWorld: false
  },
  {
    name: 'list_activity',
    title: 'Activity log',
    operationId: 'activity.list',
    openWorld: false
  },
  {
    name: 'get_settings',
    title: 'Instance settings',
    operationId: 'settings.get',
    openWorld: false
  },
  {
    name: 'create_lightning_address',
    title: 'Create a lightning address',
    operationId: 'wallet.addresses.create',
    openWorld: false
  }
]
