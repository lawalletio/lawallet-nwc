export const scan = {
  title: 'Scan',
  foreignCard: (cardHost: string, here: string) =>
    `This card belongs to ${cardHost}, not ${here}. Open it there to activate.`,
  differentCommunity: 'Different community',
  openLink: 'Open link',
  scanAnother: 'Scan another',
  cameraUnavailable: 'Camera unavailable',
  backToWallet: 'Back to wallet',
  requestingCamera: 'Requesting camera access…',
  readingCode: 'Reading code…',
  hint: 'Point your camera at a Lightning invoice, address, LNURL, or card QR.',
  unrecognizedLnurl: 'Unrecognized LNURL',
  unrecognizedQr: 'Unrecognized QR code'
}
