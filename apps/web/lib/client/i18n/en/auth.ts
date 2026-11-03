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
      "Your passkey provider can't create the key LaWallet needs. Use Google Password Manager or iCloud Keychain, or sign in another way.",
    'foreign-passkey':
      "This passkey belongs to another app, so LaWallet can't sign in with it. Use a LaWallet passkey or sign in another way.",
    'import-blocked':
      "Your browser could not access passkeys from that domain here. The domain must authorize this site's address, and your browser must support cross-site passkeys. Choose another source or sign in another way.",
    'import-derived':
      "This passkey creates its key itself, so it can't be moved to LaWallet. Export the key from the other app and sign in with it instead.",
    'import-unsupported':
      "LaWallet can't read the key in this passkey. Export the key from the other app and sign in with it instead.",
    'stored-key-missing':
      "The key for this passkey wasn't found. LaWallet did not create a new account.",
    'stored-key-invalid':
      "The key saved with this passkey doesn't match it, so LaWallet won't use it.",
    'store-failed':
      "Your passkey provider couldn't save the key, so nothing was saved. You can delete the new LaWallet passkey from your provider and try another one.",
    'key-owned':
      'This key already belongs to another LaWallet account. Sign out and sign in with it instead.'
  },
  // passkey-import-panel
  passkeyImport: {
    thisApp: 'LaWallet',
    manualDomain: 'Another domain',
    domainLabel: 'Passkey domain',
    domainHint: 'Enter the domain where you created your passkey.',
    invalidDomain:
      'Enter a domain such as passkeys.example.com, without a URL or path.',
    providerSourceNotice:
      'Signing with a provider keeps the key there. Recovering from a backup lets LaWallet read the key; only do that if you trust this app.',
    backupFile: 'Nosskey account backup',
    backupInvalid: 'Choose a valid backup (up to 8 KB).',
    rememberBackup:
      'Remember this account and its encrypted backup on this device',
    providerNotice:
      'Your provider keeps the signing key. This connection ends when you sign out or reload.',
    signWithProvider: (label: string) => `Sign with ${label}`,
    searchSources: 'Search apps or enter a domain',
    accessNotice: 'Unlocking shares your signing key with LaWallet.',
    temporaryBody:
      'Use this account for this session. Reloading or signing out locks it again. You can add a LaWallet passkey later in Security settings.',
    rememberAccount: 'Remember this account on this device',
    useThisTime: 'Use this time',

    open: 'Use a passkey from another app',
    title: 'Use a passkey from another app',
    subtitle: 'Bring the Nostr account a passkey from another app keeps.',
    chooseSource: 'Choose your passkey’s app',
    pickAccount: 'This passkey keeps several accounts. Choose the one to use.',
    account: (n: number) => `Account ${n}`,
    defaultAccount: 'Default',
    confirmTitle: 'Is this your account?',
    confirmBody: 'Check that this is the account you want to use here.',
    confirm: 'Yes, this is my account',
    choiceTitle: 'How do you want to sign in next time?',
    keepTitle: 'Keep using this passkey',
    keepBody:
      "LaWallet unlocks your key for each session using the other app's passkey. It does not create a new passkey. If that app removes access, use another recovery method.",
    copyTitle: 'Make a LaWallet passkey',
    copyBody:
      'LaWallet keeps its own copy in a new passkey. It works without the other app, but now there are two copies to keep safe.',
    continue: 'Continue',
    kept: 'Done. Sign in with this passkey from now on.',
    rememberedTitle: 'Passkey from another app',
    rememberedBody:
      'This device signs in with it. LaWallet has no passkey copy.',
    forget: 'Forget it on this device',
    forgotten: 'Forgotten on this device.',
    useAnother: 'Use a different passkey',
    pickAgain:
      "This passkey doesn't have the account you used before. Choose one.",
    notMine: 'Not my account',
    waiting: 'Waiting for your device…',
    saved: 'Passkey saved. Use it to sign in from now on.'
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
  goHome: 'Go home'
}
