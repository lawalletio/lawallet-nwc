/** Public onboarding: landing, login, sign-up, account creation, welcome. */
export const onboarding = {
  landing: {
    tagline:
      'Manage and store your sats, experiences, and lightning identity in one place.',
    createAccount: 'Create account',
    login: 'Login'
  },
  login: {
    title: 'Login',
    subtitle: 'Sign in with a passkey or your Nostr credentials.',
    passkey: 'Continue with passkey',
    or: 'or',
    continueWithNostr: 'Continue with Nostr',
    newHere: 'New to LaWallet?',
    createAccount: 'Create an account'
  },
  nostr: {
    title: 'Continue with Nostr',
    subtitle: 'Choose how you want to connect your Nostr key.',
    submit: 'Login',
    loading: 'Signing in...'
  },
  signup: {
    title: 'Create your account',
    subtitlePasskey:
      'Use a passkey for the simplest start — or pick a Nostr key if you know your way around.',
    subtitleNostr:
      'LaWallet uses Nostr for identity. Pick how you want to sign in.',
    passkey: 'Create with a passkey',
    randomKey: 'Create a random key',
    haveKey: 'I already have a key'
  },
  createAccount: {
    title: 'Create Account',
    subtitle:
      'We generated a private key for your new wallet. Save it somewhere safe — losing it means losing access to your account.',
    confirmLabel:
      "I've saved my private key. I understand that if I lose it, I'll lose access to my account.",
    creating: 'Creating account...',
    failed: 'Failed to create account'
  },
  passkey: {
    title: 'Create with a passkey',
    subtitle: (community: string | null) =>
      `Your device creates a passkey${community ? ` for ${community}` : ''} — Face ID, Touch ID, or screen lock. No passwords, nothing to write down.`,
    benefitBiometric:
      'Sign in with just your fingerprint, face, or device PIN.',
    benefitSync:
      'Works across your devices — synced passkeys sign in anywhere, and any browser can use a phone via QR.',
    benefitKey:
      'Your Nostr key is derived from the passkey itself — the same key on every device it syncs to, never stored on a server.',
    cancelled: 'Passkey prompt was closed — try again',
    waiting: 'Waiting for your device…',
    submit: 'Create my account'
  },
  welcome: {
    title: 'Welcome to LaWallet',
    body: 'This wallet is part of a self-custodial community platform built on Lightning and Nostr. You hold your own keys, and every payment routes through your Nostr Wallet Connect connection.',
    thingsToKnow: 'A few things to know',
    tipKey: 'Your private key never leaves this device.',
    tipAddress: 'You can claim a free Lightning address inside the wallet.',
    tipSats: 'Send and receive in sats without a custodian.',
    enter: 'Enter wallet'
  }
}
