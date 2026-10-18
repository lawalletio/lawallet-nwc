import type { errors as En } from '../en/errors'

export const errors: typeof En = {
  destination: {
    empty: 'Ingresa un destinatario',
    unsupported:
      'Destinatario no compatible. Usa una dirección Lightning, una factura bolt11 o un LNURL.',
    invalidInvoice: 'Factura Lightning inválida',
    invalidLnurl: 'LNURL inválido',
    invalidAddress: 'Dirección Lightning inválida'
  },
  lnurl: {
    unreachable: 'No se pudo conectar con el servicio LNURL',
    httpStatus: status => `El servicio LNURL respondió ${status}`,
    invalidResponse: 'El servicio LNURL devolvió una respuesta inválida',
    endpointError: 'El servicio LNURL devolvió un error',
    unsupported: 'Tipo de LNURL no compatible',
    missingFields: 'Al voucher de retiro le faltan datos obligatorios',
    noAmount: 'El voucher de retiro no tiene un monto disponible',
    belowOneSat: 'El monto disponible es menor a 1 sat',
    invalidCallback: 'El voucher de retiro tiene una URL de callback inválida',
    withdrawUnreachable: 'No se pudo conectar con el servicio de retiro',
    withdrawStatus: status => `El servicio de retiro respondió ${status}`,
    rejected: 'La solicitud de retiro fue rechazada'
  },
  boltcard: {
    noInvoice: 'No hay ninguna factura para cobrar.',
    notBoltcard: 'Esta etiqueta no es una BoltCard.',
    aboveMax: (limit, amount) =>
      `Esta tarjeta puede pagar hasta ${limit.toLocaleString()} sats. Esta factura es de ${amount.toLocaleString()} sats.`,
    belowMin: (limit, amount) =>
      `El mínimo de esta tarjeta es ${limit.toLocaleString()} sats. Esta factura es de ${amount.toLocaleString()} sats.`,
    rejected: 'Se rechazó el pago con la tarjeta.',
    unreachable: 'No se pudo conectar con la tarjeta.',
    cannotPay: 'Esta tarjeta no puede pagar en este momento.'
  },
  nfc: {
    readError:
      'No se pudo leer la tarjeta. Mantenla quieta y vuelve a intentarlo.',
    noLink: 'Esta etiqueta no tiene un enlace de BoltCard.',
    startError: 'No se pudo iniciar NFC. Inténtalo de nuevo.'
  },
  payment: {
    amountRequired: 'Ingresa un monto',
    zeroAmountInvoice: 'Ingresa un monto para esta factura sin monto',
    npubUnsupported: 'Todavía no se pueden enviar zaps a npubs'
  },
  nwc: {
    relayOffline:
      'No se pudo conectar con tu billetera. Su relay parece estar desconectado — revisa la conexión de la billetera e inténtalo de nuevo.',
    timeout: 'Tu billetera no respondió a tiempo. Inténtalo de nuevo.',
    generic: 'Algo salió mal. Inténtalo de nuevo.'
  }
}
