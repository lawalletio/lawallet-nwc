export const auth = {
  // secret-key-reveal
  savedKeyConfirm:
    "I've saved my private key. I understand that if I lose it, I'll lose access to my account.",
  keyCopied: 'Private key copied',
  keyCopyFailed: 'Copy failed — please reveal and write down the key',
  hideKey: 'Hide private key',
  revealKey: 'Reveal private key',
  copyKey: 'Copy private key',
  // passkey-login-button
  createWithPasskey: 'Create with a passkey',
  continueWithPasskey: 'Continue with passkey',
  waitingForDevice: 'Waiting for your device…',
  crossDeviceHint:
    'No passkey on this device? Choose “use a phone or tablet” when prompted and scan the QR with the device that has one.',
  passkeyErrors: {
    cancelled: 'Passkey prompt was closed or timed out — try again',
    duplicate: 'This device already has a passkey for this account',
    unsupported: 'This device does not support passkeys',
    'prf-unsupported':
      "Your passkey provider can't create the key LaWallet needs. Use Google Password Manager or iCloud Keychain, or sign in another way."
  },
  // nostr-connect-form
  login: 'Login',
  signingIn: 'Signing in...',
  privateKeyTab: 'Private key',
  orContinueWith: 'Or continue with',
  nsecPlaceholder: 'nsec or hex private key...',
  toggleKeyVisibility: 'Show or hide private key',
  toggleUrlVisibility: 'Show or hide URL',
  loginFailed: 'Failed to login',
  bunkerMustStart: 'URL must start with bunker://',
  bunkerBadPubkey: 'Invalid bunker URL: missing or invalid public key',
  bunkerNoRelay: 'Invalid bunker URL: missing relay parameter',
  bunkerBadFormat: 'Invalid bunker URL format',
  showQr: 'Show QR',
  pasteUrl: 'Paste URL',
  connectFailed: 'Failed to connect',
  connectTimedOut:
    'Connection timed out. Make sure your signer app scanned the QR code.',
  generatingConnection: 'Generating connection...',
  signerConnected: 'Signer connected, logging in...',
  tryAgain: 'Try Again',
  copiedBang: 'Copied!',
  copyUri: 'Copy URI',
  waitingForSigner: 'Waiting for signer to connect...',
  scanWithSignerPrefix: 'Scan with your signer app (',
  scanWithSignerSuffix: ', Amber, etc.)',
  bunkerConnectFailed: 'Failed to connect to bunker',
  extensionConnectFailed: 'Failed to connect with extension',
  connecting: 'Connecting...',
  withExtension: 'With extension',
  // route-error
  errorTitle: 'Something went wrong',
  errorBody: 'This screen hit an unexpected error. Try again or go back home.',
  errorRetry: 'Try again',
  goHome: 'Go home',
  // email-login-form (also used, in English, by the admin login modal)
  emailLogin: {
    label: 'Email',
    placeholder: 'you@example.com',
    submit: 'Continue with email',
    sending: 'Sending link…',
    invalid: 'Enter a valid email address',
    checkInbox: 'Check your inbox',
    sentTo: (email: string) =>
      `We sent a sign-in link to ${email}. Open it on this device to continue.`,
    resend: 'Resend link',
    resendIn: (seconds: number) => `Resend in ${seconds}s`,
    useDifferent: 'Use a different email',
    failed: 'Could not send the link — try again'
  },
  // email magic-link landing
  emailLanding: {
    eyebrow: 'Magic link',
    checking: 'Checking your link…',
    welcomeBack: 'Welcome back,',
    signInTo: 'Sign in to',
    welcomeTo: 'Welcome to',
    returningBody: "Confirm it's you to open your wallet.",
    newBody: 'Your wallet is one tap away.',
    perks: {
      address: 'Your own Lightning address',
      nostr: 'A Nostr identity, ready to use',
      custody: 'Move to self-custody whenever you want'
    },
    continueAs: (name: string) => `Continue as ${name}`,
    continue: 'Continue',
    createAccount: 'Create my wallet',
    signingIn: 'Signing you in…',
    oneTime: 'One-time link — it stops working once you continue.',
    success: "You're in",
    redirecting: 'Taking you to your wallet…',
    redirectingProfile: "Let's set up your profile…",
    redirectingDashboard: 'Taking you to your dashboard…',
    linkEyebrow: 'Link email',
    linkTitle: 'Add this email to',
    linkYourAccount: 'your account',
    linkSignedIn: 'Signed in',
    linkBody:
      "Confirm it's yours and you'll be able to sign in to your account with it.",
    linkCta: 'Confirm email',
    linking: 'Confirming…',
    linkedTitle: 'Email linked',
    linkMergeTitle: 'This email has an account',
    redirectingAccount: 'Taking you to your account…',
    redirectingMerge: 'Taking you to merge the two accounts…',
    invalidEyebrow: 'Link unavailable',
    invalidTitle: 'This link has expired',
    invalidBody:
      'Sign-in links work once and expire after 15 minutes. Request a new one to continue.',
    requestNew: 'Get a new link',
    poweredBy: 'Powered by'
  }
}
