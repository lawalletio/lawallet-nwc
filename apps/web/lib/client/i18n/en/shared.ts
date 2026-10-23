/** Building blocks reused across wallet screens (nav, receipts, inputs…). */
export const shared = {
  goBack: 'Go back',
  offlineMode: 'Offline mode',
  nav: {
    label: 'Wallet actions',
    home: 'Home',
    settings: 'Settings',
    scan: 'Scan QR'
  },
  balance: {
    unavailable: 'Unavailable',
    loading: 'Loading balance'
  },
  tx: {
    received: 'Received',
    sent: 'Sent',
    justNow: 'Just now',
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    daysAgo: (n: number) => `${n}d ago`
  },
  pagination: {
    label: (label: string) => `${label} pagination`,
    page: (n: number) => `Page ${n}`,
    previous: 'Previous',
    next: 'Next',
    previousPage: (label: string) => `Previous ${label} page`,
    nextPage: (label: string) => `Next ${label} page`
  },
  relay: {
    badge: 'Relay error — tap for details',
    offline: 'Offline',
    title: 'Wallet relay unavailable',
    generic:
      'Last request to the wallet relay failed. The wallet will keep retrying in the background.',
    timeout:
      'The wallet relay timed out. Check the device hosting your wallet, or your internet connection.',
    unreachable:
      'Could not reach the wallet relay. Check your internet connection and try again.'
  },
  receipt: {
    shareTitle: 'Payment receipt',
    copied: 'Receipt copied',
    shareFailed: 'Could not share receipt',
    pending: 'Pending',
    failed: 'Failed',
    settled: 'Settled',
    unavailable: 'Unavailable',
    proofTitle: 'Payment proof',
    proofHint: 'Reveal or copy these only when you need a receipt.',
    notProvided: 'Not provided by wallet',
    show: (label: string) => `Show ${label.toLowerCase()}`,
    hide: (label: string) => `Hide ${label.toLowerCase()}`,
    viewActivity: 'View activity',
    text: {
      title: 'LaWallet payment receipt',
      status: 'Status',
      amount: 'Amount',
      fee: 'Fee',
      to: 'To',
      destination: 'Destination',
      note: 'Note',
      time: 'Time',
      paymentHash: 'Payment hash',
      preimage: 'Preimage'
    }
  },
  qr: {
    copyFailed: 'Copy failed'
  },
  forwarding: {
    busy: 'Payment forwarding in progress',
    statuses: {
      COMPLETED: 'Completed',
      SUCCEEDED: 'Succeeded',
      PAID: 'Paid',
      SETTLED: 'Settled',
      RETAINED: 'Retained',
      BLOCKED: 'Blocked',
      REJECTED: 'Rejected',
      EXPIRED: 'Expired',
      FAILED: 'Failed',
      RECEIVED: 'Received',
      FORWARDING: 'Forwarding',
      AWAITING_FORWARDING: 'Awaiting forwarding',
      PARTIAL: 'Partial',
      PENDING: 'Pending',
      READY: 'Ready',
      UNKNOWN: 'Unknown'
    }
  },
  protocol: {
    notChecked: 'Not checked',
    supported: 'Supported',
    notSupported: 'Not supported',
    onThisAddress: 'On this address',
    useCases: 'What it makes possible',
    specification: 'Specification',
    openDetails: (label: string, state: string) =>
      `${label} — ${state}. Open details`,
    clickForDetails: 'click for details'
  },
  keypad: {
    label: 'Amount keypad',
    deleteLast: 'Delete last digit',
    enter: (key: string) => `Enter ${key}`
  },
  currencyToggle: 'Display currency',
  addressInput: {
    options: 'Lightning address options',
    saved: 'Saved',
    suggestions: 'Suggestions',
    change: 'Change'
  }
}
