/** Wallet home screen. */
export const home = {
  account: 'Account',
  accountWithKey: (short: string) => `Account · ${short}`,
  adminDashboard: 'Admin dashboard',
  logOut: 'Log out',
  communityLogoAlt: 'Community',
  showBalance: 'Show balance',
  hideBalance: 'Hide balance',
  yourBalance: 'Your balance',
  bonusNote: (sats: string) =>
    `Includes ${sats} sats from activating your card.`,
  dismissBonus: 'Dismiss card bonus note',
  receive: 'Receive',
  send: 'Send',
  address: 'Address',
  claimAddress: 'Claim your free Lightning address',
  autoCreateTitle: 'Your wallet is created when you receive',
  autoCreateBody:
    'No setup needed — tap Receive and we’ll spin up a wallet automatically for your first payment.',
  noWalletTitle: 'No wallet connected',
  noWalletBody:
    'Connect a Nostr Wallet Connect URI to start sending and receiving.',
  connectWallet: 'Connect a wallet',
  activityTitle: 'Activity',
  viewAll: 'View all',
  list: {
    activity: {
      connect: 'Connect a wallet to see your activity.',
      loading: 'Loading activity…',
      error: 'Couldn’t load activity.',
      empty: 'No activity yet.'
    }
  },
  install: {
    nativeTitle: 'Install the wallet',
    nativeBody: 'Add it to your home screen for quick access.',
    iosTitle: 'Add to your Home Screen',
    iosBody:
      'Tap Share, then Add to Home Screen. You can keep using the wallet either way.',
    install: 'Install',
    dismiss: 'Dismiss install prompt'
  }
}
