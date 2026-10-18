export const claim = {
  headerTitle: 'Claim address',
  paymentTitle: 'Payment',
  heading: 'Claim your Lightning address',
  introActivateFree:
    'Your card is ready. Pick a username — this first Lightning address is free.',
  introActivate:
    'Your card is ready. Pick a username so you can receive Lightning payments.',
  intro:
    'Pick a username — this is where you’ll receive Lightning payments. It’s free.',
  cardBonus: (sats: string) =>
    `${sats} sats from this card are already in your balance.`,
  username: 'Username',
  checkingAvailability: 'Checking availability…',
  taken: 'That username is taken.',
  available: 'Available',
  usernameHint: 'Lowercase letters and numbers, max 16 characters.',
  claiming: 'Claiming…',
  claimAddress: 'Claim address',
  paymentFailedTitle: 'Payment couldn’t be started',
  paymentFailedBody: (address: string) =>
    `We couldn’t reach the payment provider for ${address}.`,
  tryAgain: 'Try again',
  generatingInvoice: 'Generating your invoice…',
  payAmount: (sats: number) => `Pay ${sats} sats`,
  toClaim: 'To claim',
  invoiceExpired:
    'This invoice expired before a payment was detected. If you were charged, contact the operator — otherwise generate a fresh invoice.',
  newInvoice: 'Generate new invoice',
  confirmInWallet: 'Confirm in wallet…',
  payWithWallet: 'Pay with Wallet',
  copied: 'Copied!',
  copyInvoice: 'Copy Invoice',
  waitingPayment: 'Waiting for payment…',
  checking: 'Checking…',
  checkNow: 'I’ve paid — check now',
  detected: 'Payment detected! Claiming address…',
  claimedTitle: 'Address claimed!',
  claimedBody: 'Your new Lightning address is ready to receive payments.',
  goToWallet: 'Go to wallet',
  yourDomain: 'your-domain',
  dialog: {
    title: 'New address',
    creating: 'Creating…',
    create: 'Create',
    preparingPayment: 'Preparing payment',
    registeredTitle: 'Address registered!',
    registeredBody: 'Your new lightning address is now active.',
    redirecting: 'Taking you to your dashboard…',
    configure: 'Configure'
  },
  errors: {
    maxLength: 'Max 16 characters.',
    charset: 'Lowercase letters and numbers only.',
    claimFailed: 'Failed to claim address',
    paidIncomplete:
      'Paid registration is configured but incomplete on this instance. Contact the operator.',
    providerUnreachable: 'Could not reach the payment provider.',
    createFailed: 'Failed to create address',
    walletPaymentFailed: 'Wallet payment failed',
    cantRecheck: 'This invoice can’t be re-checked — generate a new one.',
    noPaymentYet:
      'No payment detected yet. If you just paid, give it a few seconds.',
    verifierUnreachable:
      'Couldn’t reach the payment verifier — check your connection and try again.'
  }
}
