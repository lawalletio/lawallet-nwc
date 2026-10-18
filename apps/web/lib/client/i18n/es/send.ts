import type { send as En } from '../en/send'

export const send: typeof En = {
  title: 'Enviar',
  amountTitle: 'Monto',
  previewTitle: 'Revisar',
  to: 'Para',
  note: 'Nota',
  networkFee: 'Comisión de red',
  invalidRecipient: 'Destinatario inválido',
  loadingNext: 'Cargando la siguiente pantalla',
  kind: {
    invoice: 'Factura Lightning',
    address: 'Dirección Lightning',
    nostrProfile: 'Perfil de Nostr',
    nostrZap: 'Zap de Nostr'
  },
  amount: {
    notePlaceholder: 'Agrega una nota (opcional)',
    noteAria: 'Nota para el destinatario',
    noteHint: 'El destinatario verá esto.',
    noteMax: n => `${n} máx.`,
    noteLeft: n => (n === 1 ? 'Queda 1' : `Quedan ${n}`)
  },
  preview: {
    sending: 'Enviando',
    type: 'Tipo',
    noteOmitted:
      'El destinatario no acepta notas. Este pago se enviará sin ella.',
    pay: amount => `Pagar ${amount} sats`,
    quoteUnavailable: 'Cotización no disponible',
    quotingPayment: 'Cotizando el pago...',
    preparingQuote: 'Preparando la cotización del pago',
    quoteFailed: 'Falló la cotización',
    noWallet: 'No hay billetera conectada',
    paymentFailed: 'El pago falló',
    swipeToPay: 'Desliza para pagar',
    releaseToConfirm: 'Suelta para confirmar',
    paying: 'Pagando...',
    quote: 'Cotización',
    beforeSending: 'Antes de enviar',
    amount: 'Monto',
    total: 'Total',
    feeQuoting: 'Cotizando...',
    feeUnavailable: 'No disponible',
    feeNotQuoted: 'La billetera no la cotizó',
    plusFee: amount => `${amount} sats + comisión`,
    feeQuoteUnavailable:
      'NWC informa las comisiones de ruteo solo después de que pay_invoice se liquida.',
    equivalents: 'Equivalencias',
    statusQuoting: 'Cotizando',
    statusFailed: 'Falló',
    statusReady: 'Lista'
  },
  summary: {
    title: 'Pago enviado',
    destination: 'Destino',
    time: 'Hora',
    paymentHash: 'Hash del pago',
    preimage: 'Preimagen'
  }
}
