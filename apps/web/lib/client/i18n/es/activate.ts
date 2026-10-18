import type { activate as En } from '../en/activate'

export const activate: typeof En = {
  eyebrow: 'Activa tu tarjeta',
  activate: 'Activar',
  activating: 'Activando tu tarjeta…',
  failed: 'No se pudo activar.',
  openWallet: 'Abrir billetera',
  cardAlt: 'Diseño de la tarjeta',
  error: {
    title: 'Algo salió mal',
    invalidLink: 'Este enlace de activación no es válido.',
    loadFailed: 'No se pudo cargar esta tarjeta.',
    tryAgain: 'Intentar de nuevo'
  },
  unsupported: {
    title: 'Aún no disponible',
    body: 'Esta tarjeta usa un tipo de activación que todavía no está disponible.'
  },
  claimed: {
    title: 'Ya activada',
    body: 'Esta tarjeta ya está vinculada a una billetera.'
  },
  expired: {
    title: 'Activación vencida',
    body: 'Este enlace de activación ya no es válido. Pídele un QR nuevo a quien emitió la tarjeta.'
  },
  revoked: {
    title: 'Enlace revocado',
    body: 'Este enlace de activación fue revocado. Pídele un QR nuevo a quien emitió la tarjeta.'
  },
  success: {
    title: '¡Tarjeta activada!',
    linkedNamed:
      ' ya está vinculada a tu billetera y lista para pagar con un toque.',
    linked:
      'Tu tarjeta ya está vinculada a tu billetera y lista para pagar con un toque.',
    bonus: sats => `Ya tienes ${sats} sats en tu saldo.`,
    claimAddress: 'Reclama tu dirección'
  },
  inlineAuth: {
    intro:
      'Activa esta tarjeta con una passkey nueva o una clave de Nostr nueva.',
    introNoPasskey:
      'Este navegador no puede crear una passkey. Abre esta página en Safari o Chrome, o continúa con una clave de Nostr.',
    passkey: 'Passkey',
    duplicate: 'Este dispositivo ya tiene una passkey.',
    nostr: 'Nostr',
    newKeyTitle: 'Tu nueva clave de Nostr',
    newKeyBody:
      'Guárdala en un lugar seguro: es la única forma de volver a tu billetera y a los fondos de la tarjeta.',
    confirmLabel:
      'Guardé mi clave privada y entiendo que no se puede recuperar.',
    connectFailed: 'No se pudo conectar',
    activating: 'Activando…',
    createAndActivate: 'Crear y activar'
  }
}
