import type { claim as En } from '../en/claim'

export const claim: typeof En = {
  headerTitle: 'Reclamar dirección',
  paymentTitle: 'Pago',
  heading: 'Reclama tu dirección Lightning',
  introActivateFree:
    'Tu tarjeta está lista. Elige un nombre de usuario — esta primera dirección Lightning es gratis.',
  introActivate:
    'Tu tarjeta está lista. Elige un nombre de usuario para recibir pagos Lightning.',
  intro:
    'Elige un nombre de usuario — ahí recibirás tus pagos Lightning. Es gratis.',
  cardBonus: (sats: string) =>
    `${sats} sats de esta tarjeta ya están en tu saldo.`,
  username: 'Nombre de usuario',
  checkingAvailability: 'Verificando disponibilidad…',
  taken: 'Ese nombre de usuario ya está en uso.',
  available: 'Disponible',
  usernameHint: 'Letras minúsculas y números, máximo 16 caracteres.',
  claiming: 'Reclamando…',
  claimAddress: 'Reclamar dirección',
  paymentFailedTitle: 'No se pudo iniciar el pago',
  paymentFailedBody: (address: string) =>
    `No pudimos contactar al proveedor de pagos para ${address}.`,
  tryAgain: 'Reintentar',
  generatingInvoice: 'Generando tu factura…',
  payAmount: (sats: number) => `Paga ${sats} sats`,
  toClaim: 'Para reclamar',
  invoiceExpired:
    'Esta factura venció antes de detectar un pago. Si se te cobró, contacta al operador; si no, genera una factura nueva.',
  newInvoice: 'Generar factura nueva',
  confirmInWallet: 'Confirma en tu billetera…',
  payWithWallet: 'Pagar con billetera',
  copied: '¡Copiada!',
  copyInvoice: 'Copiar factura',
  waitingPayment: 'Esperando el pago…',
  checking: 'Verificando…',
  checkNow: 'Ya pagué — verificar ahora',
  detected: '¡Pago detectado! Reclamando dirección…',
  claimedTitle: '¡Dirección reclamada!',
  claimedBody: 'Tu nueva dirección Lightning está lista para recibir pagos.',
  goToWallet: 'Ir a la billetera',
  yourDomain: 'tu-dominio',
  dialog: {
    title: 'Nueva dirección',
    creating: 'Creando…',
    create: 'Crear',
    preparingPayment: 'Preparando el pago',
    registeredTitle: '¡Dirección registrada!',
    registeredBody: 'Tu nueva dirección Lightning ya está activa.',
    redirecting: 'Llevándote a tu panel…',
    configure: 'Configurar'
  },
  errors: {
    maxLength: 'Máximo 16 caracteres.',
    charset: 'Solo letras minúsculas y números.',
    claimFailed: 'No se pudo reclamar la dirección',
    paidIncomplete:
      'El registro pago está configurado pero incompleto en esta instancia. Contacta al operador.',
    providerUnreachable: 'No se pudo contactar al proveedor de pagos.',
    createFailed: 'No se pudo crear la dirección',
    walletPaymentFailed: 'Falló el pago con la billetera',
    cantRecheck:
      'Esta factura no se puede volver a verificar — genera una nueva.',
    noPaymentYet:
      'Todavía no se detectó el pago. Si acabas de pagar, espera unos segundos.',
    verifierUnreachable:
      'No se pudo contactar al verificador de pagos — revisa tu conexión y vuelve a intentarlo.'
  }
}
