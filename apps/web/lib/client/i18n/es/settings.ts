import type { settings as En } from '../en/settings'

export const settings: typeof En = {
  title: 'Ajustes',
  account: 'Cuenta',
  preferences: 'Preferencias',
  support: 'Soporte',
  dangerZone: 'Zona de peligro',
  myCards: 'Mis tarjetas',
  security: 'Seguridad',
  remoteWallets: 'Billeteras remotas',
  language: 'Idioma',
  currencies: 'Monedas',
  paymentSound: 'Sonido de pago',
  helpCenter: 'Centro de ayuda',
  reportBug: 'Reportar un error',
  removeWallet: 'Eliminar billetera',
  removeWalletConfirm:
    '¿Eliminar esta billetera del dispositivo? Podrás volver a ingresar con tu clave privada.',
  communityBy: 'Comunidad por LaWallet',
  version: (v: string) => `Versión ${v}`,
  languageScreen: {
    automatic: 'Automático',
    automaticHint: (name: string) => `Idioma del dispositivo · ${name}`
  },
  cardsScreen: {
    enabledToast: (name: string) => `${name} activada`,
    disabledToast: (name: string) => `${name} desactivada`,
    updateFailed: 'No se pudo actualizar esta tarjeta',
    linkedToast: (name: string) => `${name} vinculada a esta billetera`,
    linkFailed: 'No se pudo vincular esta tarjeta',
    available: 'Tarjetas disponibles',
    linkToWallet: 'Vincular a esta billetera',
    tapPayments: 'Pagos con toque',
    enable: (name: string) => `Activar ${name}`,
    disable: (name: string) => `Desactivar ${name}`,
    status: { Active: 'Activa', Disabled: 'Desactivada', Blocked: 'Bloqueada' },
    statusLabel: (status: string) => `Estado de la tarjeta: ${status}`,
    loading: 'Cargando tarjetas',
    emptyTitle: 'Aún no tienes tarjetas',
    emptyBody: 'Las tarjetas vinculadas a tu billetera aparecerán aquí.',
    manage: 'Administrar tarjetas',
    errorTitle: 'Tarjetas no disponibles',
    tryAgain: 'Intenta de nuevo en un momento.',
    fallbackName: 'Tarjeta',
    balanceSharing: {
      toggle: 'Mostrar saldo al cobrar',
      hint: 'Después de pagar con tu tarjeta, el punto de venta puede mostrar el saldo de tu wallet. Desactívalo para mantener tu saldo privado.',
      enabled: 'Saldo visible al cobrar',
      disabled: 'Saldo oculto al cobrar',
      failed: 'No se pudo actualizar el saldo al cobrar'
    }
  },
  currenciesScreen: {
    title: 'Moneda',
    activeAssets: 'Activos',
    hint: 'Los satoshis son tu activo principal. Agrega una moneda de referencia para ver el valor fiat de tu saldo.',
    searchPlaceholder: 'Buscar moneda...',
    available: 'Referencias disponibles',
    noMatch: 'Ninguna moneda coincide.',
    alwaysActive: 'Siempre activa',
    remove: (name: string) => `Quitar ${name}`,
    reorder: (name: string) => `Reordenar ${name}`,
    add: (name: string) => `Agregar ${name}`
  },
  passkeysScreen: {
    added: 'Passkey agregada',
    addFailed: 'No se pudo agregar la passkey',
    renamed: 'Passkey renombrada',
    renameFailed: 'No se pudo renombrar',
    deleted: 'Passkey eliminada',
    deleteFailed: 'No se pudo eliminar',
    empty:
      'Aún no tienes passkeys. Agrega una para ingresar con Face ID, Touch ID o el bloqueo de pantalla de tu dispositivo, sin pegar claves.',
    lastUsed: (when: string) => `Último uso ${when}`,
    addedAgo: (when: string) => `Agregada ${when}`,
    synced: 'Sincronizada',
    waiting: 'Esperando a tu dispositivo…',
    add: 'Agregar una passkey',
    manage: 'Administrar passkey',
    name: 'Nombre',
    namePlaceholder: 'p. ej. Touch ID de MacBook',
    saveName: 'Guardar nombre',
    delete: 'Eliminar passkey',
    deleteOnlyTitle: '¿Eliminar tu única passkey?',
    deleteTitle: '¿Eliminar esta passkey?',
    deleteOnlyBody:
      'Esta es tu única passkey. Su clave se puede seguir derivando de la passkey, pero asegúrate de poder ingresar de otra forma antes de quitarla aquí.',
    deleteBody:
      'Ya no podrás ingresar con esta passkey después de eliminarla. La identidad que deriva sigue vinculada a tu cuenta.',
    deleteConfirm: 'Eliminar',
    untitled: (date: string) => `Passkey · ${date}`
  },
  paymentSoundScreen: {
    successful: 'Pago exitoso',
    radioLabel: 'Sonido de pago exitoso',
    sounds: {
      chime: { label: 'Campanilla', description: 'Tono corto' },
      bananero: { label: 'Sapeee', description: 'El Bananero' },
      off: { label: 'Apagado', description: 'Sin sonido' }
    }
  },
  securityScreen: {
    npubCopied: 'npub copiada',
    copyFailed: 'No se pudo copiar la npub',
    signerReady: 'Firmante listo',
    signerUnavailable: 'Firmante no disponible',
    removeConfirm: '¿Eliminar esta billetera de este dispositivo?',
    noSecret: 'No hay ninguna clave privada guardada en este dispositivo',
    publicKey: 'Clave pública',
    notSignedIn: 'Sin sesión',
    role: 'Rol',
    roles: {
      USER: 'Usuario',
      VIEWER: 'Lector',
      OPERATOR: 'Operador',
      ADMIN: 'Administrador'
    },
    unknown: 'Desconocido',
    loginMethod: 'Método de ingreso',
    methods: {
      bunker: 'Bunker',
      extension: 'Extensión',
      nsec: 'Clave privada',
      passkey: 'Passkey'
    },
    session: 'Sesión',
    signer: 'Firmante',
    active: 'Activa',
    sessionLocked: 'Bloqueada',
    signerLocked: 'Bloqueado',
    unlocked: 'Desbloqueado',
    verifySigner: 'Verificar firmante',
    passkeys: 'Passkeys',
    connectedApps: 'Apps conectadas',
    secretKey: 'Clave privada',
    revealSecret: 'Mostrar clave privada',
    passkeyKeyHint:
      'Tu clave se deriva de tu passkey y se guarda solo en este dispositivo. Respáldala para usar esta identidad en otras apps de Nostr.',
    nsecKeyHint:
      'Tu clave se guarda solo en este dispositivo. Respáldala para no perder el acceso si pierdes este dispositivo.',
    device: 'Dispositivo',
    removeDevice: 'Eliminar billetera del dispositivo',
    copyLabel: (label: string) => `Copiar ${label}`,
    cardRecovery: {
      title: 'Recuperación con tarjeta',
      toggle: 'Recuperar con mis tarjetas',
      hint: 'Quien tenga una de tus tarjetas puede pasar toda esta cuenta a una clave nueva en un punto de venta LaWallet. Desactívalo para que una tarjeta perdida no sirva para quedarse con tu cuenta.',
      enabled: 'Recuperación con tarjeta activada',
      disabled: 'Recuperación con tarjeta desactivada',
      failed: 'No se pudo actualizar la recuperación con tarjeta'
    }
  },
  accountTransfer: {
    title: 'Tu cuenta fue transferida',
    body: (date: string, card: string) =>
      `El ${date}, tu tarjeta ${card} se usó en un punto de venta LaWallet para pasar esta cuenta a otra clave.`,
    unnamedCard: '(sin nombre)',
    moved: 'Qué se transfirió',
    cards: n => (n === 1 ? '1 tarjeta' : `${n} tarjetas`),
    wallets: n => (n === 1 ? '1 billetera' : `${n} billeteras`),
    notYou:
      'Si no fuiste tú, contacta a tu operador de inmediato. Puedes desactivar la Recuperación con tarjeta en Seguridad para que una tarjeta no pueda volver a hacerlo.',
    dismiss: 'Entendido'
  }
}
