import type { cashOut as En } from '../en/cashOut'

export const cashOut: typeof En = {
  title: 'Retirar a banco',
  homeCta: 'Retirar a una cuenta bancaria (ARS)',
  amountLabel: 'Monto en pesos',
  amountPlaceholder: '10000',
  destinationLabel: 'CBU, CVU o alias',
  destinationPlaceholder: 'mi.alias.mp o 22 dígitos',
  destinationInvalid:
    'Ingresá un CBU/CVU de 22 dígitos o un alias de 6 a 20 caracteres',
  holderLabel: 'Titular de la cuenta',
  lookingUp: 'Buscando la cuenta…',
  notFound: 'No encontramos esa cuenta',
  bank: (bank: string) => `Banco: ${bank}`,
  providerLabel: 'Proveedor',
  quoting: 'Cotizando…',
  noProviders: 'No hay proveedores de retiro disponibles ahora.',
  quoteSats: (sats: string) => `${sats} sats`,
  minimum: (ars: string) => `Mínimo ARS ${ars}`,
  needsCbu: 'Requiere CBU/CVU',
  unavailable: 'No disponible',
  continue: 'Continuar',
  creating: 'Preparando la orden…',
  youPay: 'Pagás',
  theyReceive: 'Recibe',
  to: 'A',
  via: 'Vía',
  pay: (sats: string) => `Pagar ${sats} sats`,
  paying: 'Pagando…',
  noWallet: 'Conectá una billetera para retirar.',
  paymentFailed: 'El pago falló',
  createFailed: 'No pudimos crear la orden',
  status: {
    PENDING: 'Transferencia en curso',
    COMPLETED: 'Pesos enviados',
    FAILED: 'La transferencia falló',
    EXPIRED: 'Orden vencida',
    CANCELED: 'Orden cancelada'
  },
  pendingBody:
    'Tus sats se enviaron. La transferencia suele acreditarse en minutos.',
  completedBody: 'La transferencia bancaria se completó.',
  failedBody:
    'El proveedor informó un error. Contactá al admin de la comunidad con esta orden.',
  expiredBody: 'La factura no se pagó, así que no se movieron fondos.',
  receipt: 'Ver comprobante',
  done: 'Listo'
}
