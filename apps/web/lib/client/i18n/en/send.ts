export const send = {
  title: 'Send',
  amountTitle: 'Amount',
  previewTitle: 'Preview',
  to: 'To',
  note: 'Note',
  networkFee: 'Network fee',
  invalidRecipient: 'Invalid recipient',
  loadingNext: 'Loading next screen',
  kind: {
    invoice: 'Lightning invoice',
    address: 'Lightning address',
    nostrProfile: 'Nostr profile',
    nostrZap: 'Nostr zap'
  },
  amount: {
    notePlaceholder: 'Add a note (optional)',
    noteAria: 'Note for recipient',
    noteHint: 'The recipient will see this.',
    noteMax: (n: number) => `${n} max`,
    noteLeft: (n: number) => `${n} left`
  },
  preview: {
    sending: 'Sending',
    type: 'Type',
    noteOmitted:
      'The recipient did not accept the note. This payment will be sent without it.',
    pay: (amount: string) => `Pay ${amount} sats`,
    quoteUnavailable: 'Quote unavailable',
    quotingPayment: 'Quoting payment...',
    preparingQuote: 'Preparing payment quote',
    quoteFailed: 'Quote failed',
    noWallet: 'No wallet connected',
    paymentFailed: 'Payment failed',
    swipeToPay: 'Swipe to pay',
    releaseToConfirm: 'Release to confirm',
    paying: 'Paying...',
    quote: 'Quote',
    beforeSending: 'Before sending',
    amount: 'Amount',
    total: 'Total',
    feeQuoting: 'Quoting...',
    feeUnavailable: 'Unavailable',
    feeNotQuoted: 'Not quoted by wallet',
    plusFee: (amount: string) => `${amount} sats + fee`,
    feeQuoteUnavailable:
      'NWC returns routing fees only after pay_invoice settles.',
    equivalents: 'Equivalents',
    statusQuoting: 'Quoting',
    statusFailed: 'Failed',
    statusReady: 'Ready'
  },
  summary: {
    title: 'Payment sent',
    destination: 'Destination',
    time: 'Time',
    paymentHash: 'Payment hash',
    preimage: 'Preimage'
  }
}
