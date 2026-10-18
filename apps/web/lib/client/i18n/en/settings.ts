export const settings = {
  title: 'Settings',
  account: 'Account',
  preferences: 'Preferences',
  support: 'Support',
  dangerZone: 'Danger Zone',
  myCards: 'My Cards',
  security: 'Security',
  remoteWallets: 'Remote wallets',
  language: 'Language',
  currencies: 'Currencies',
  paymentSound: 'Payment sound',
  helpCenter: 'Help Center',
  reportBug: 'Report a bug',
  removeWallet: 'Remove Wallet',
  removeWalletConfirm:
    'Remove this wallet from the device? You can sign back in with your private key.',
  communityBy: 'Community by LaWallet',
  version: (v: string) => `Version ${v}`,
  languageScreen: {
    automatic: 'Automatic',
    automaticHint: (name: string) => `Device language · ${name}`
  },
  cardsScreen: {
    enabledToast: (name: string) => `${name} enabled`,
    disabledToast: (name: string) => `${name} disabled`,
    updateFailed: 'Could not update this card',
    linkedToast: (name: string) => `${name} linked to this wallet`,
    linkFailed: 'Could not link this card',
    available: 'Available cards',
    linkToWallet: 'Link to this wallet',
    tapPayments: 'Tap payments',
    enable: (name: string) => `Enable ${name}`,
    disable: (name: string) => `Disable ${name}`,
    status: { Active: 'Active', Disabled: 'Disabled', Blocked: 'Blocked' },
    statusLabel: (status: string) => `Card status: ${status}`,
    loading: 'Loading cards',
    emptyTitle: 'No cards yet',
    emptyBody: 'Cards paired to your wallet will appear here.',
    manage: 'Manage cards',
    errorTitle: 'Cards unavailable',
    tryAgain: 'Try again in a moment.',
    fallbackName: 'Card'
  },
  currenciesScreen: {
    title: 'Currency',
    activeAssets: 'Active Assets',
    hint: 'Satoshi are your core assets. Add a reference currency to visualize the fiat value of your balance.',
    searchPlaceholder: 'Search currency...',
    available: 'Available References',
    noMatch: 'No matching currency.',
    alwaysActive: 'Always active',
    remove: (name: string) => `Remove ${name}`,
    reorder: (name: string) => `Reorder ${name}`,
    add: (name: string) => `Add ${name}`
  },
  passkeysScreen: {
    added: 'Passkey added',
    addFailed: 'Could not add passkey',
    renamed: 'Passkey renamed',
    renameFailed: 'Rename failed',
    deleted: 'Passkey deleted',
    deleteFailed: 'Delete failed',
    empty:
      'No passkeys yet. Add one to sign in with Face ID, Touch ID, or your device screen lock — no keys to paste.',
    lastUsed: (when: string) => `Last used ${when}`,
    addedAgo: (when: string) => `Added ${when}`,
    synced: 'Synced',
    waiting: 'Waiting for your device…',
    add: 'Add a passkey',
    manage: 'Manage passkey',
    name: 'Name',
    namePlaceholder: 'e.g. MacBook Touch ID',
    saveName: 'Save name',
    delete: 'Delete passkey',
    deleteOnlyTitle: 'Delete your only passkey?',
    deleteTitle: 'Delete this passkey?',
    deleteOnlyBody:
      'This is your only passkey. Its key stays derivable from the passkey itself, but make sure you can still sign in another way before removing it here.',
    deleteBody:
      'You can no longer sign in with this passkey after deleting it. The identity it derives stays linked to your account.',
    deleteConfirm: 'Delete',
    untitled: (date: string) => `Passkey · ${date}`
  },
  paymentSoundScreen: {
    successful: 'Successful payment',
    radioLabel: 'Successful payment sound',
    sounds: {
      chime: { label: 'Chime', description: 'Short tone' },
      bananero: { label: 'Sapeee', description: 'El Bananero' },
      off: { label: 'Off', description: 'No sound' }
    }
  },
  securityScreen: {
    npubCopied: 'npub copied',
    copyFailed: 'Could not copy npub',
    signerReady: 'Signer ready',
    signerUnavailable: 'Signer unavailable',
    removeConfirm: 'Remove this wallet from this device?',
    noSecret: 'No secret key is stored on this device',
    publicKey: 'Public key',
    notSignedIn: 'Not signed in',
    role: 'Role',
    roles: {
      USER: 'User',
      VIEWER: 'Viewer',
      OPERATOR: 'Operator',
      ADMIN: 'Admin'
    } as Record<string, string>,
    unknown: 'Unknown',
    loginMethod: 'Login method',
    methods: {
      bunker: 'Bunker',
      extension: 'Extension',
      nsec: 'Private key',
      passkey: 'Passkey'
    },
    session: 'Session',
    signer: 'Signer',
    active: 'Active',
    sessionLocked: 'Locked',
    signerLocked: 'Locked',
    unlocked: 'Unlocked',
    verifySigner: 'Verify signer',
    passkeys: 'Passkeys',
    connectedApps: 'Connected apps',
    secretKey: 'Secret key',
    revealSecret: 'Reveal secret key',
    passkeyKeyHint:
      'Your key is derived from your passkey and stored only on this device. Back it up to use this identity in other Nostr apps.',
    nsecKeyHint:
      'Your key is stored only on this device. Back it up to keep access if this device is lost.',
    device: 'Device',
    removeDevice: 'Remove wallet from device',
    copyLabel: (label: string) => `Copy ${label}`
  }
}
