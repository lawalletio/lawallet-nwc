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
  },
  /** A RECOVER QR printed by card-manager: moves the card's whole account. */
  recover: {
    eyebrow: 'Recover your account',
    action: 'Recover account',
    recovering: 'Recovering your account…',
    failed: 'Recovery failed.',
    intro: "Recover this card's account onto a new passkey or a new Nostr key.",
    introNoPasskey:
      'This browser cannot create a passkey. Open this page in Safari or Chrome, or continue with a Nostr key.',
    working: 'Recovering…',
    createAndRecover: 'Create & recover',
    merge: {
      title: 'Merge into your account?',
      body: "You're signed in to an account that already has data. Recovering moves everything from the card's account into it.",
      yours: 'Your account',
      incoming: "From the card's account",
      noAddress: 'No lightning address',
      cards: (n: number) => (n === 1 ? '1 card' : `${n} cards`),
      wallets: (n: number) => (n === 1 ? '1 wallet' : `${n} wallets`),
      keepsPrimary:
        'Your current primary address stays primary. You can change it later in Settings.',
      confirm: 'Merge & recover',
      cancel: 'Cancel'
    },
    done: {
      title: 'Account recovered',
      body: "Everything from the card's account is now in this wallet.",
      merged: "Everything from the card's account was merged into this wallet.",
      addresses: 'Lightning addresses',
      cards: 'Cards',
      wallets: 'Remote wallets',
      totalBalance: 'Total balance',
      unavailable: 'Unavailable',
      none: 'None',
      untitledCard: 'Card',
      defaultWallet: 'Default',
      vouchers: (n: number) => (n === 1 ? '1 voucher' : `${n} vouchers`),
      openWallet: 'Open wallet',
      claimAddress: 'Claim your address'
    }
  }
}
