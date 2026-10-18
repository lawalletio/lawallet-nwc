export const withdraw = {
  title: 'Withdraw',
  cta: 'Withdraw',
  ctaAmount: (amount: string) => `Withdraw ${amount} sats`,
  fixedAmount: 'Fixed voucher amount',
  range: (min: string, max: string) => `${min}–${max} sats`,
  from: 'Withdraw from',
  voucher: 'Lightning voucher',
  noWallet: 'No wallet connected',
  noWalletBody:
    'Connect a wallet that can receive payments to claim this voucher.',
  manageWallets: 'Manage wallets',
  celebration: {
    mute: 'Mute claim sound',
    unmute: 'Unmute claim sound',
    eyebrowClaimed: 'Treasure claimed',
    eyebrowClaiming: 'Lightning claim',
    won: 'You won!',
    onItsWay: 'Prize on its way',
    opening: 'Opening the treasure',
    pendingBody:
      "The claim is in. They'll join your balance once the sender pays.",
    calling: (amount: string) => `Calling ${amount} sats down the lightning.`,
    srLanded: (amount: string) => `${amount} sats landed in your wallet.`,
    srOnTheWay: (amount: string) => `${amount} sats are on the way.`,
    collect: 'Collect',
    replay: 'Replay',
    listening: 'Listening for the payment',
    balance: 'Balance',
    holding: 'Holding',
    pending: 'Pending',
    syncing: 'Syncing',
    meter: 'Balance filling with claimed sats',
    before: (amount: string) => `Before ${amount}`,
    claimed: (amount: string) => `Claimed +${amount}`,
    chest: 'Treasure chest opening'
  }
}
