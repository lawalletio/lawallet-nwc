// Copy for the error codes the shared lib helpers tag their messages with
// (see ../errors.ts). English mirrors the helpers' own messages.
export const errors = {
  destination: {
    empty: 'Enter a recipient',
    unsupported:
      'Unsupported recipient. Use a Lightning address, bolt11 invoice, or LNURL.',
    invalidInvoice: 'Invalid Lightning invoice',
    invalidLnurl: 'Invalid LNURL',
    invalidAddress: 'Invalid Lightning address'
  },
  lnurl: {
    unreachable: 'Could not reach the LNURL endpoint',
    httpStatus: (status: number) => `LNURL endpoint returned ${status}`,
    invalidResponse: 'LNURL endpoint returned an invalid response',
    endpointError: 'LNURL endpoint returned an error',
    unsupported: 'Unsupported LNURL type',
    missingFields: 'Withdraw voucher is missing required fields',
    noAmount: 'Withdraw voucher has no withdrawable amount',
    belowOneSat: 'Withdrawable amount is below 1 sat',
    invalidCallback: 'Withdraw voucher has an invalid callback URL',
    withdrawUnreachable: 'Could not reach the withdraw service',
    withdrawStatus: (status: number) => `Withdraw service returned ${status}`,
    rejected: 'The withdraw request was rejected'
  },
  boltcard: {
    noInvoice: 'There is no invoice to charge.',
    notBoltcard: 'This tag is not a BoltCard.',
    aboveMax: (limit: number, amount: number) =>
      `This card can pay up to ${limit.toLocaleString()} sats. This invoice is ${amount.toLocaleString()} sats.`,
    belowMin: (limit: number, amount: number) =>
      `This card's minimum is ${limit.toLocaleString()} sats. This invoice is ${amount.toLocaleString()} sats.`,
    rejected: 'The card payment was rejected.',
    unreachable: 'Could not reach the card.',
    cannotPay: 'This card cannot pay right now.'
  },
  nfc: {
    readError: 'Could not read the card. Hold it steady and try again.',
    noLink: 'This tag has no BoltCard link.',
    startError: 'Could not start NFC. Try again.'
  },
  payment: {
    amountRequired: 'Enter an amount',
    zeroAmountInvoice: 'Enter an amount for this zero-amount invoice',
    npubUnsupported: 'Zaps to npubs are not supported yet'
  },
  nwc: {
    relayOffline:
      "Couldn't reach your wallet. Its relay looks offline — check the wallet connection and try again.",
    timeout: "Your wallet didn't respond in time. Please try again.",
    generic: 'Something went wrong. Please try again.'
  }
}
