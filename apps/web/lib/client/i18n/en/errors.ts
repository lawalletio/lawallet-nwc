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
  nwc: {
    relayOffline:
      "Couldn't reach your wallet. Its relay looks offline — check the wallet connection and try again.",
    timeout: "Your wallet didn't respond in time. Please try again.",
    generic: 'Something went wrong. Please try again.'
  }
}
