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
  goHome: 'Go home'
}
