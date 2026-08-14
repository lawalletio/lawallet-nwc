import { LaWalletError } from './errors'
import { createHttpClient, type HttpClient } from './http'
import { checkVerifyOnce, pollVerifyUrl, type VerifyResult } from './lnurl'
import { createNip98QueryToken, createNip98Token } from './nip98'
import type { NostrSigner } from './signer'
import {
  subscribeEvents,
  type EventSourceConstructor,
  type SSEEventType,
  type SSEStatus
} from './sse'
import type {
  AddressInvoice,
  ClaimInvoiceResult,
  CreateRemoteWalletInput,
  CreateWalletAddressInput,
  CurrentUser,
  FreeRegistration,
  Lud06Invoice,
  Lud06Response,
  Nip05Response,
  PublicInstanceSettings,
  RegistrationInvoice,
  RemoteWallet,
  UpdateRemoteWalletInput,
  UpdateWalletAddressInput,
  UsernameAvailability,
  WalletAddress,
  WalletAddressDetailResponse
} from './types'

export interface LaWalletClientOptions {
  /**
   * Public origin of the LaWallet instance, e.g. `https://wallet.example.com`.
   * Must be the URL the instance is publicly reachable at — NIP-98 signatures
   * commit to it, so a proxy that rewrites the origin breaks authentication.
   */
  endpoint: string
  /** Signs one kind-27235 event per authenticated request. The signer IS the session. */
  signer?: NostrSigner | null
  /** Pre-issued Bearer token (e.g. an admin-minted device token). Signer takes precedence. */
  token?: string | null
  /** Called on any 401 response. */
  onUnauthorized?: () => void
  fetchImpl?: typeof fetch
  /** EventSource injection for environments without a global (older Node, tests). */
  EventSourceImpl?: EventSourceConstructor
}

export interface ClaimAddressOptions {
  username: string
  /**
   * Called with the invoice when the instance requires payment — render its
   * `bolt11` as a QR and keep awaiting: the returned promise resolves once
   * the payment settles and the address is claimed.
   */
  onInvoice?: (invoice: RegistrationInvoice) => void
  signal?: AbortSignal
  /** LUD-21 poll interval in ms (default 3000). */
  pollIntervalMs?: number
}

export interface ClaimAddressResult {
  lightningAddress: string
  paid: boolean
}

/**
 * Typed client for a LaWallet instance.
 *
 * Nostr-first: every authenticated request is a NIP-98 event signed by the
 * user's key, committing to the exact URL, method and body. There is no
 * login step and no session to refresh — pass a signer and start calling.
 *
 * ```ts
 * const wallet = new LaWalletClient({
 *   endpoint: 'https://wallet.example.com',
 *   signer: nsecSigner(nsec)
 * })
 * const me = await wallet.users.me()
 * ```
 */
export class LaWalletClient {
  readonly endpoint: string

  private signer: NostrSigner | null
  private token: string | null
  private readonly http: HttpClient
  private readonly fetchImpl?: typeof fetch
  private readonly eventSourceImpl?: EventSourceConstructor

  constructor(options: LaWalletClientOptions) {
    const endpoint = options.endpoint?.replace(/\/+$/, '')
    if (!endpoint || !/^https?:\/\//.test(endpoint)) {
      throw new Error(
        'LaWalletClient requires `endpoint` to be the absolute public URL of the instance (e.g. https://wallet.example.com)'
      )
    }
    this.endpoint = endpoint
    this.signer = options.signer ?? null
    this.token = options.token ?? null
    this.fetchImpl = options.fetchImpl
    this.eventSourceImpl = options.EventSourceImpl
    this.http = createHttpClient({
      endpoint,
      getAuthHeader: (url, init) => this.buildAuthHeader(url, init),
      onUnauthorized: options.onUnauthorized,
      fetchImpl: options.fetchImpl
    })
  }

  /** Swap the active signer (login/logout). `null` drops authentication. */
  setSigner(signer: NostrSigner | null): void {
    this.signer = signer
  }

  getSigner(): NostrSigner | null {
    return this.signer
  }

  /** Swap the Bearer escape-hatch token. A signer, when set, takes precedence. */
  setToken(token: string | null): void {
    this.token = token
  }

  /** Pubkey of the active signer, or null when unauthenticated. */
  async getPublicKey(): Promise<string | null> {
    return this.signer ? this.signer.getPublicKey() : null
  }

  private async buildAuthHeader(
    url: string,
    init: { method: string; body?: string }
  ): Promise<string | null> {
    if (this.signer) {
      return createNip98Token(url, init, this.signer)
    }
    if (this.token) {
      return `Bearer ${this.token}`
    }
    throw new LaWalletError(
      401,
      'No signer configured — pass `signer` to LaWalletClient (or call setSigner) before using authenticated endpoints',
      'NO_SIGNER'
    )
  }

  private async eventsToken(): Promise<string> {
    if (this.signer) {
      return createNip98QueryToken(`${this.endpoint}/api/events`, this.signer)
    }
    if (this.token) {
      return this.token
    }
    throw new LaWalletError(401, 'No signer configured', 'NO_SIGNER')
  }

  private async resolveDomain(): Promise<string> {
    const settings = await this.settings.get().catch(() => null)
    return settings?.domain || new URL(this.endpoint).hostname
  }

  /** Unauthenticated instance discovery: branding, domain, feature flags. */
  readonly settings = {
    get: (): Promise<PublicInstanceSettings> =>
      this.http.get('/api/settings', { auth: false })
  }

  readonly users = {
    /** Fetches the current user — the first authenticated call creates it. */
    me: (): Promise<CurrentUser> => this.http.get('/api/users/me')
  }

  readonly addresses = {
    list: (): Promise<WalletAddress[]> =>
      this.http.get('/api/wallet/addresses'),

    /**
     * One address. The endpoint wraps the address in a detail envelope
     * (alongside the caller's wallets and derived routing info); this unwraps
     * it so the shape matches `list()` and `update()`.
     */
    get: (username: string): Promise<WalletAddress> =>
      this.http
        .get<WalletAddressDetailResponse>(
          `/api/wallet/addresses/${encodeURIComponent(username)}`
        )
        .then(response => response.address),

    /** The full detail envelope: the address plus the caller's wallets and routing info. */
    getDetail: (username: string): Promise<WalletAddressDetailResponse> =>
      this.http.get(`/api/wallet/addresses/${encodeURIComponent(username)}`),

    /** Throws `LaWalletError` with `status: 402` when the instance requires payment. */
    create: (input: CreateWalletAddressInput): Promise<WalletAddress> =>
      this.http.post('/api/wallet/addresses', input),

    /** Routing config — alias redirect and NWC binding live here. */
    update: (
      username: string,
      input: UpdateWalletAddressInput
    ): Promise<WalletAddress> =>
      this.http.put(
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        input
      ),

    remove: (username: string): Promise<void> =>
      this.http.del(`/api/wallet/addresses/${encodeURIComponent(username)}`),

    setPrimary: (username: string): Promise<void> =>
      this.http.post(
        `/api/wallet/addresses/${encodeURIComponent(username)}/primary`
      ),

    invoices: (username: string): Promise<AddressInvoice[]> =>
      this.http
        .get<{
          invoices: AddressInvoice[]
        }>(`/api/wallet/addresses/${encodeURIComponent(username)}/invoices`)
        .then(response => response.invoices),

    checkAvailability: (username: string): Promise<UsernameAvailability> =>
      this.http.get(
        `/api/lightning-addresses/check?username=${encodeURIComponent(username)}`,
        { auth: false }
      )
  }

  readonly registration = {
    /** Mints the lightning invoice that pays for a username. */
    createInvoice: (
      username: string,
      purpose: 'wallet-address' | 'registration' = 'wallet-address'
    ): Promise<RegistrationInvoice | FreeRegistration> =>
      this.http.post('/api/invoices', { purpose, metadata: { username } }),

    /** Proves payment (sha256(preimage) === paymentHash) and creates the address. */
    claimInvoice: (
      invoiceId: string,
      preimage: string
    ): Promise<ClaimInvoiceResult> =>
      this.http.post(`/api/invoices/${encodeURIComponent(invoiceId)}/claim`, {
        preimage
      }),

    /**
     * The whole claim flow in one call: tries the free path, and when the
     * instance answers 402 mints an invoice (handed to `onInvoice` for QR
     * display), polls its LUD-21 verify URL until settled, then claims with
     * the preimage. An invoice that was already claimed resolves as success.
     */
    claimAddress: (opts: ClaimAddressOptions): Promise<ClaimAddressResult> =>
      this.claimAddressFlow(opts)
  }

  readonly remoteWallets = {
    list: (): Promise<RemoteWallet[]> => this.http.get('/api/remote-wallets'),

    get: (id: string): Promise<RemoteWallet> =>
      this.http.get(`/api/remote-wallets/${encodeURIComponent(id)}`),

    /** NWC config shape: `{ connectionString: 'nostr+walletconnect://…' }`. */
    create: (input: CreateRemoteWalletInput): Promise<RemoteWallet> =>
      this.http.post('/api/remote-wallets', input),

    /** Asks the instance to mint a disposable LNCurl-backed NWC wallet. */
    createLncurl: (input?: {
      name?: string
      isDefault?: boolean
    }): Promise<RemoteWallet> =>
      this.http.post('/api/remote-wallets/lncurl', input ?? {}),

    update: (
      id: string,
      patch: UpdateRemoteWalletInput
    ): Promise<RemoteWallet> =>
      this.http.patch(`/api/remote-wallets/${encodeURIComponent(id)}`, patch),

    /** Soft-revokes the wallet. */
    remove: (id: string): Promise<void> =>
      this.http.del(`/api/remote-wallets/${encodeURIComponent(id)}`),

    /** Owner-only. The pairing secret — handle with care. */
    connectionString: (id: string): Promise<string> =>
      this.http
        .get<{
          connectionString: string
        }>(`/api/remote-wallets/${encodeURIComponent(id)}/connection-string`)
        .then(response => response.connectionString),

    balance: (id: string): Promise<number> =>
      this.http
        .get<{
          balanceSats: number
        }>(`/api/remote-wallets/${encodeURIComponent(id)}/balance`)
        .then(response => response.balanceSats)
  }

  /** Public LUD-16 payment endpoints — no authentication involved. */
  readonly lud16 = {
    resolve: (username: string): Promise<Lud06Response> =>
      this.http.get(`/api/lud16/${encodeURIComponent(username)}`, {
        auth: false
      }),

    /** Resolves the address and requests a bolt11 invoice for `amountMsat`. */
    requestInvoice: async (
      username: string,
      amountMsat: number,
      opts?: { comment?: string }
    ): Promise<Lud06Invoice> => {
      const payRequest = await this.lud16.resolve(username)
      const callback = new URL(payRequest.callback)
      callback.searchParams.set('amount', String(amountMsat))
      if (opts?.comment) {
        callback.searchParams.set('comment', opts.comment)
      }
      const doFetch =
        this.fetchImpl ??
        ((...args: Parameters<typeof fetch>) => fetch(...args))
      const response = await doFetch(callback.toString())
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.status === 'ERROR') {
        throw new LaWalletError(
          response.status,
          body?.reason || `LNURL callback failed (${response.status})`,
          'LNURL_ERROR'
        )
      }
      return body as Lud06Invoice
    },

    /** Single-shot LUD-21 settlement check. */
    verify: (verifyUrl: string): Promise<VerifyResult> =>
      checkVerifyOnce(verifyUrl, { fetchImpl: this.fetchImpl }),

    /** Polls a LUD-21 verify URL until settled (or timeout/abort). */
    pollVerify: (
      verifyUrl: string,
      opts?: { interval?: number; timeout?: number; signal?: AbortSignal }
    ): Promise<VerifyResult> =>
      pollVerifyUrl(verifyUrl, { ...opts, fetchImpl: this.fetchImpl })
  }

  readonly nip05 = {
    /** NIP-05 lookup on this instance (`/.well-known/nostr.json?name=`). */
    lookup: (name: string): Promise<Nip05Response> => {
      const doFetch =
        this.fetchImpl ??
        ((...args: Parameters<typeof fetch>) => fetch(...args))
      return doFetch(
        `${this.endpoint}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
      ).then(response => response.json() as Promise<Nip05Response>)
    }
  }

  readonly events = {
    /**
     * Live change notifications over SSE. Signs a fresh NIP-98 event per
     * (re)connect. Returns an unsubscribe function.
     */
    subscribe: (
      onEvent: (type: SSEEventType, data: Record<string, unknown>) => void,
      opts?: {
        types?: readonly SSEEventType[]
        onStatus?: (status: SSEStatus) => void
      }
    ): (() => void) =>
      subscribeEvents({
        url: `${this.endpoint}/api/events`,
        getToken: () => this.eventsToken(),
        onEvent,
        types: opts?.types,
        onStatus: opts?.onStatus,
        EventSourceImpl: this.eventSourceImpl
      })
  }

  private async claimAddressFlow(
    opts: ClaimAddressOptions
  ): Promise<ClaimAddressResult> {
    const { username } = opts

    try {
      await this.addresses.create({ username })
      return {
        lightningAddress: `${username}@${await this.resolveDomain()}`,
        paid: false
      }
    } catch (error) {
      if (!(error instanceof LaWalletError) || error.status !== 402) {
        throw error
      }
    }

    const invoice = await this.registration.createInvoice(username)
    if ('free' in invoice && invoice.free) {
      throw new LaWalletError(
        503,
        'Paid registration is configured but incomplete — contact the instance operator',
        'PAID_REGISTRATION_INCOMPLETE'
      )
    }

    const pending = invoice as RegistrationInvoice
    opts.onInvoice?.(pending)

    // Poll for the invoice's full lifetime — a shorter cutoff strands users
    // whose payment lands late even though the bolt11 is still valid.
    const timeout = Math.max(
      new Date(pending.expiresAt).getTime() - Date.now(),
      0
    )
    const settled = await pollVerifyUrl(pending.verify, {
      signal: opts.signal,
      timeout,
      interval: opts.pollIntervalMs,
      fetchImpl: this.fetchImpl
    })
    if (!settled.preimage) {
      throw new LaWalletError(
        402,
        'Payment settled but the verifier returned no preimage',
        'MISSING_PREIMAGE'
      )
    }

    try {
      const claim = await this.registration.claimInvoice(
        pending.id,
        settled.preimage
      )
      return {
        lightningAddress:
          claim.lightningAddress ?? `${username}@${await this.resolveDomain()}`,
        paid: true
      }
    } catch (error) {
      // A prior claim succeeded but its response was lost — the address
      // exists and is ours, so surface success rather than an error.
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('already been claimed')
      ) {
        return {
          lightningAddress: `${username}@${await this.resolveDomain()}`,
          paid: true
        }
      }
      throw error
    }
  }
}
