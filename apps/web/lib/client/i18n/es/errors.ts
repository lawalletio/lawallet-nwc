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
  nwc: {
    relayOffline:
      'No se pudo conectar con tu billetera. Su relay parece estar desconectado — revisa la conexión de la billetera e inténtalo de nuevo.',
    timeout: 'Tu billetera no respondió a tiempo. Inténtalo de nuevo.',
    generic: 'Algo salió mal. Inténtalo de nuevo.'
  }
}
