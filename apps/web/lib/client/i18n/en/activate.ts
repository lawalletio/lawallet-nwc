/** Card activation (`/wallet/activate/[id]`). Also rendered by admin card previews. */
export const activate = {
  eyebrow: 'Activate your card',
  activate: 'Activate',
  activating: 'Activating your card…',
  failed: 'Activation failed.',
  openWallet: 'Open wallet',
  cardAlt: 'Card design',
  error: {
    title: 'Something went wrong',
    invalidLink: 'This activation link is invalid.',
    loadFailed: 'Could not load this card.',
    tryAgain: 'Try again'
  },
  unsupported: {
    title: 'Not supported yet',
    body: "This card uses an activation type that isn't available yet."
  },
  claimed: {
    title: 'Already activated',
    body: 'This card has already been linked to a wallet.'
  },
  expired: {
    title: 'Activation expired',
    body: 'This activation link is no longer valid. Ask the issuer for a fresh QR.'
  },
  revoked: {
    title: 'Link revoked',
    body: 'This activation link has been revoked. Ask the issuer for a fresh QR.'
  },
  success: {
    title: 'Card activated!',
    /** Follows the bold card title. */
    linkedNamed: ' is now linked to your wallet and ready to tap-to-pay.',
    linked: 'Your card is now linked to your wallet and ready to tap-to-pay.',
    bonus: (sats: string) => `${sats} sats are already in your balance.`,
    claimAddress: 'Claim your address'
  },
  inlineAuth: {
    intro: 'Activate this card with a new passkey or a new Nostr key.',
    introNoPasskey:
      'This browser cannot create a passkey. Open this page in Safari or Chrome, or continue with a Nostr key.',
    passkey: 'Passkey',
    duplicate:
      'This device already has a passkey — tap “I already have an account”.',
    haveAccount: 'I already have an account',
    nostr: 'Nostr',
    newKeyTitle: 'Your new Nostr key',
    newKeyBody:
      "Save it somewhere safe — it's the only way back into your wallet and the card's funds.",
    confirmLabel:
      "I've saved my private key and understand it can't be recovered.",
    connectFailed: 'Could not connect',
    activating: 'Activating…',
    createAndActivate: 'Create & activate'
  }
}
