export const receive = {
  title: 'Receive',
  invoiceTitle: 'Invoice',
  noAddress:
    "You don't have a Lightning address yet. Claim one to receive payments.",
  claimUsername: 'Claim a username',
  requestAmount: 'Request specific amount',
  noWallet: 'No wallet connected',
  notePlaceholder: 'Add a note (optional)',
  creatingInvoice: 'Creating invoice…',
  waitingPayment: 'Waiting for payment…',
  nfc: {
    cardAccepted: 'Card accepted',
    slowConfirm:
      'The card accepted this invoice. It can take a moment to arrive.',
    confirming: 'Confirming the payment…',
    unsupported: 'NFC unavailable on this device. Pay by scanning the QR.',
    needsPermission: 'Allow NFC to charge this invoice from a BoltCard.',
    allow: 'Allow NFC',
    scanning: 'Hold a BoltCard to the back of the phone',
    charging: 'Charging the card…',
    blocked:
      'NFC permission was blocked. Allow it in the browser, then try again.',
    failed: 'Could not charge the card.',
    tryAgain: 'Try again'
  },
  summary: {
    title: 'Payment received',
    note: 'Note',
    time: 'Time',
    paymentHash: 'Payment hash',
    preimage: 'Preimage'
  }
}
