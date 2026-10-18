const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const addresses = {
  paymentHash: 'Payment hash',
  destination: 'Destination',
  destinationInvoice: 'Destination invoice',
  attemptNo: (n: number) => `Attempt #${n}`,
  invoiceDetails: {
    stillBlocked: 'Forwarding is still blocked',
    completed: 'Forwarding completed',
    retryStarted: 'Forwarding retry started',
    retryFailed: 'Could not retry forwarding',
    destinationUpdated: 'Destination updated — ready to retry',
    changeFailed: 'Could not change destination',
    proxyTitle: 'Proxy payment details',
    title: 'Invoice details',
    routedTo: (destination: string) =>
      `Received for this address and routed to ${destination}.`,
    paymentPath: 'Payment path',
    serviceFeePct: (pct: string) => `${pct}% service fee`,
    received: 'Received',
    incomingInvoice: 'Incoming invoice',
    serviceFee: 'Service fee',
    bpsRetained: (bps: number) => `${bps} bps retained`,
    forwarded: 'Forwarded',
    reservedToForward: 'Reserved to forward',
    routingFeeByProxy: 'Routing fee paid by proxy wallet',
    notChargedYet: 'Not charged yet',
    needsAttention: 'Forwarding needs attention',
    retryForwarding: 'Retry forwarding',
    changeAddress: 'Change address',
    newAddress: 'New Lightning Address',
    saveDestination: 'Save destination',
    rerouteNote:
      'Only this payment is rerouted. Future payments keep the address’s current destination.',
    invoices: 'Invoices',
    bothLegs: 'Receive and destination legs',
    receiveLeg: 'Receive leg',
    settlement: 'Settlement',
    forwardingAttempts: (n: number) =>
      plural(n, 'forwarding attempt', 'forwarding attempts'),
    sourceSettled: 'Source settled',
    forwardedAmount: 'Forwarded amount',
    notForwarded: 'Not forwarded',
    retries: 'Retries',
    zapReceipt: 'Zap receipt',
    published: (date: string) => `Published ${date}`,
    notPublished: 'Not published',
    updated: 'Updated',
    zapReceiptEvent: 'Zap receipt event',
    attemptHistory: 'Attempt history',
    latestOf: (shown: number, total: number) => `Latest ${shown} of ${total}`,
    notRecorded: 'Not recorded',
    expectedAmount: (amount: string) =>
      `Expected amount ${amount}. No valid destination invoice reached the forwarding queue.`,
    destinationInvoiceNo: (n: number) => `Destination invoice · #${n}`,
    created: 'Created',
    resolved: 'Resolved',
    notYet: 'Not yet'
  },
  invoicesCard: {
    title: 'Recent invoices',
    refresh: 'Refresh invoices',
    loadFailed: 'Couldn’t load invoices.',
    empty: 'No invoices yet.',
    fallbackLine: 'Lightning payment',
    viewDetails: (name: string) => `View details for ${name}`,
    status: { PAID: 'paid', PENDING: 'pending', EXPIRED: 'expired' }
  },
  protocols: {
    label: 'Receive protocols',
    servedBy: (provider: string) => ` by ${provider}`,
    notChecked: 'Not checked yet.',
    lud16Yes: (served: string) => `Resolves a payRequest${served}.`,
    lud16No: 'This address does not resolve a payRequest.',
    nip05Yes: 'Published in this domain’s nostr.json.',
    nip05No: 'The account has no usable Nostr public key.',
    lud12Yes: (served: string) => `Payers can attach a comment${served}.`,
    lud12No: 'Payer comments are not accepted.',
    lud21Proxy: 'Proxy invoices expose a settlement verification URL.',
    lud21Yes: (served: string) =>
      `Issued invoices expose a settlement verification URL${served}.`,
    lud21No: 'Issued invoices expose no verification URL.',
    nip57Proxy: 'Proxy receipts are signed and published after settlement.',
    nip57Alias: (served: string) =>
      `Advertised${served} · receipts are signed by that provider.`,
    nip57Yes: 'Settled zap invoices publish a signed receipt.',
    nip57Unavailable:
      'Unavailable until settlement detection and a receipt signer are ready.'
  },
  workspace: {
    sections: 'Proxy address sections',
    overview: 'Overview',
    paymentsReceived: 'Payments received',
    payments: 'Payments',
    activity: 'Activity'
  },
  forwardingActivity: {
    title: 'Forwarding activity',
    description:
      'Receive settlement, destination attempts, retries, and listener errors.',
    payments: 'Payments',
    attempts: 'Attempts',
    needsAttention: 'Needs attention',
    unavailableTitle: 'Activity unavailable',
    unavailableBody: 'The forwarding journal could not be loaded.',
    emptyTitle: 'No proxy activity yet',
    emptyBody: 'Attempts will appear after the first payment is received.',
    recordedRetries: (n: number) =>
      `${n.toLocaleString()} recorded ${n === 1 ? 'retry' : 'retries'} across these payments.`,
    paymentReceived: 'Payment received',
    leaseExpires: (date: string) => `Lease expires ${date}`,
    workerLease: 'Worker lease',
    net: (amount: string) => `Net ${amount}`,
    destinationAttempts: 'Destination attempts',
    counts: (attempts: number, retries: number) =>
      `${plural(attempts, 'attempt', 'attempts')} · ${plural(retries, 'retry', 'retries')}`,
    latestError: 'Latest forwarding error',
    noAttempt: 'No destination invoice attempt has been recorded. Next retry:',
    initialForward: 'Initial forward',
    retryNo: (n: number) => `Retry #${n}`,
    routingFee: (amount: string) => `Routing fee ${amount}`,
    updatedAgo: (relative: string) => `Updated ${relative}`,
    forwardingError: 'Forwarding error',
    notAccepted: 'The outgoing attempt was not accepted.',
    requestId: 'Request ID'
  },
  pendingBalance: {
    forwarded: (n: number) =>
      `${n} pending ${n === 1 ? 'payment' : 'payments'} forwarded`,
    stillNeedsAttention: 'Forwarding still needs attention',
    started: 'Pending forwarding started',
    failed: 'Could not forward pending funds',
    label: 'Pending proxy balance',
    title: 'Pending balance',
    blocked: (n: number) => `${n} blocked`,
    resolving: (n: number) => `${n} resolving`,
    unavailable: 'Pending balance unavailable',
    netAcross: (n: number) =>
      `Net amount across ${plural(n, 'payment', 'payments')}, after service fees.`,
    allForwarded: 'All confirmed proxy payments have been forwarded.',
    noDestination: 'No destination configured',
    oldestPending: (relative: string) => `Oldest pending ${relative}`,
    configuredDestination: 'Configured destination',
    forwardingAria: 'Pending funds are forwarding',
    forwardAria: 'Forward pending funds',
    inProgressHint:
      'An outgoing payment is already in progress or awaiting confirmation',
    forwardHint: 'Forward all pending proxy funds now',
    forwarding: 'Forwarding',
    starting: 'Starting',
    forwardPending: 'Forward pending',
    refresh: 'Refresh pending balance'
  },
  createProxy: {
    created: 'Proxy wallet created',
    enableFailed: 'Could not enable forwarding',
    title: 'Create proxy wallet',
    description:
      'Select an existing send-and-receive NWC wallet or connect a new one, then choose its first forwarding destination.',
    sourceWallet: 'Source wallet',
    selectWallet: 'Select a wallet',
    needNew: 'Need a new one?',
    entryFee: 'Entry fee (%)',
    baseFee: 'Base fee (sats)',
    enable: 'Enable proxy'
  }
}
