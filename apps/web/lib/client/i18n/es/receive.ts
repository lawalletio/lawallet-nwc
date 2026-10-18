import type { receive as En } from '../en/receive'

export const receive: typeof En = {
  title: 'Recibir',
  invoiceTitle: 'Factura',
  noAddress:
    'Todavía no tienes una dirección Lightning. Reclama una para recibir pagos.',
  claimUsername: 'Reclamar un nombre de usuario',
  requestAmount: 'Pedir un monto específico',
  noWallet: 'No hay billetera conectada',
  notePlaceholder: 'Agrega una nota (opcional)',
  creatingInvoice: 'Creando factura…',
  waitingPayment: 'Esperando el pago…',
  nfc: {
    cardAccepted: 'Tarjeta aceptada',
    slowConfirm:
      'La tarjeta aceptó esta factura. Puede tardar un momento en llegar.',
    confirming: 'Confirmando el pago…',
    unsupported:
      'NFC no disponible en este dispositivo. Paga escaneando el QR.',
    needsPermission: 'Permite NFC para cobrar esta factura con una BoltCard.',
    allow: 'Permitir NFC',
    scanning: 'Acerca una BoltCard a la parte trasera del teléfono',
    charging: 'Cobrando a la tarjeta…',
    blocked:
      'Se bloqueó el permiso de NFC. Permítelo en el navegador y vuelve a intentarlo.',
    failed: 'No se pudo cobrar a la tarjeta.',
    tryAgain: 'Reintentar'
  },
  summary: {
    title: 'Pago recibido',
    note: 'Nota',
    time: 'Hora',
    paymentHash: 'Hash del pago',
    preimage: 'Preimagen'
  }
}
