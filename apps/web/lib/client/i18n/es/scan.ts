import type { scan as En } from '../en/scan'

export const scan: typeof En = {
  title: 'Escanear',
  foreignCard: (cardHost, here) =>
    `Esta tarjeta pertenece a ${cardHost}, no a ${here}. Ábrela allí para activarla.`,
  differentCommunity: 'Otra comunidad',
  openLink: 'Abrir enlace',
  scanAnother: 'Escanear otro',
  cameraUnavailable: 'Cámara no disponible',
  backToWallet: 'Volver a la billetera',
  requestingCamera: 'Pidiendo acceso a la cámara…',
  readingCode: 'Leyendo código…',
  hint: 'Apunta la cámara a una factura Lightning, dirección, LNURL o QR de tarjeta.',
  unrecognizedLnurl: 'LNURL no reconocido',
  unrecognizedQr: 'Código QR no reconocido'
}
