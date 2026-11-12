import type { auth as En } from '../en/auth'

export const auth: typeof En = {
  savedKeyConfirm:
    'Guardé mi clave privada. Entiendo que si la pierdo, perderé el acceso a mi cuenta.',
  keyCopied: 'Clave privada copiada',
  keyCopyFailed: 'No se pudo copiar — muestra la clave y anótala',
  hideKey: 'Ocultar clave privada',
  revealKey: 'Mostrar clave privada',
  copyKey: 'Copiar clave privada',
  createWithPasskey: 'Crear con una passkey',
  continueWithPasskey: 'Continuar con passkey',
  waitingForDevice: 'Esperando a tu dispositivo…',
  crossDeviceHint:
    '¿No tienes una passkey en este dispositivo? Elige “usar un teléfono o tablet” cuando se te pida y escanea el QR con el dispositivo que la tiene.',
  passkeyErrors: {
    cancelled:
      'Se cerró la ventana de la passkey o se agotó el tiempo — inténtalo de nuevo',
    duplicate: 'Este dispositivo ya tiene una passkey para esta cuenta',
    unsupported: 'Este dispositivo no admite passkeys',
    'prf-unsupported':
      'Tu proveedor de passkeys no puede crear la clave que LaWallet necesita. Usa el Administrador de contraseñas de Google o el Llavero de iCloud, o inicia sesión de otra forma.'
  },
  login: 'Iniciar sesión',
  signingIn: 'Iniciando sesión...',
  privateKeyTab: 'Clave privada',
  orContinueWith: 'O continúa con',
  nsecPlaceholder: 'nsec o clave privada en hex...',
  toggleKeyVisibility: 'Mostrar u ocultar clave privada',
  toggleUrlVisibility: 'Mostrar u ocultar URL',
  loginFailed: 'No se pudo iniciar sesión',
  bunkerMustStart: 'La URL debe empezar con bunker://',
  bunkerBadPubkey:
    'URL de bunker inválida: falta la clave pública o no es válida',
  bunkerNoRelay: 'URL de bunker inválida: falta el parámetro relay',
  bunkerBadFormat: 'Formato de URL de bunker inválido',
  showQr: 'Mostrar QR',
  pasteUrl: 'Pegar URL',
  connectFailed: 'No se pudo conectar',
  connectTimedOut:
    'Se agotó el tiempo de conexión. Asegúrate de que tu app firmante haya escaneado el código QR.',
  generatingConnection: 'Generando conexión...',
  signerConnected: 'Firmante conectado, iniciando sesión...',
  tryAgain: 'Reintentar',
  copiedBang: '¡Copiado!',
  copyUri: 'Copiar URI',
  waitingForSigner: 'Esperando que el firmante se conecte...',
  scanWithSignerPrefix: 'Escanea con tu app firmante (',
  scanWithSignerSuffix: ', Amber, etc.)',
  bunkerConnectFailed: 'No se pudo conectar al bunker',
  extensionConnectFailed: 'No se pudo conectar con la extensión',
  connecting: 'Conectando...',
  withExtension: 'Con extensión',
  errorTitle: 'Algo salió mal',
  errorBody:
    'Esta pantalla tuvo un error inesperado. Inténtalo de nuevo o vuelve al inicio.',
  errorRetry: 'Reintentar',
  goHome: 'Ir al inicio',
  emailLogin: {
    label: 'Correo',
    placeholder: 'tu@ejemplo.com',
    submit: 'Continuar con correo',
    sending: 'Enviando enlace…',
    invalid: 'Ingresa un correo válido',
    checkInbox: 'Revisa tu correo',
    sentTo: (email: string) =>
      `Enviamos un enlace de acceso a ${email}. Ábrelo en este dispositivo para continuar.`,
    resend: 'Reenviar enlace',
    resendIn: (seconds: number) => `Reenviar en ${seconds}s`,
    useDifferent: 'Usar otro correo',
    failed: 'No pudimos enviar el enlace, inténtalo de nuevo'
  },
  emailLanding: {
    eyebrow: 'Enlace mágico',
    checking: 'Verificando tu enlace…',
    welcomeBack: 'Qué bueno verte,',
    signInTo: 'Inicia sesión en',
    welcomeTo: 'Bienvenido a',
    returningBody: 'Confirma que eres tú para abrir tu billetera.',
    newBody: 'Tu billetera está a un toque.',
    perks: {
      address: 'Tu propia dirección Lightning',
      nostr: 'Una identidad Nostr lista para usar',
      custody: 'Pasa a autocustodia cuando quieras'
    },
    continueAs: (name: string) => `Continuar como ${name}`,
    continue: 'Continuar',
    createAccount: 'Crear mi billetera',
    signingIn: 'Iniciando sesión…',
    oneTime: 'Enlace de un solo uso: deja de funcionar al continuar.',
    success: '¡Listo!',
    redirecting: 'Te llevamos a tu billetera…',
    redirectingProfile: 'Vamos a armar tu perfil…',
    redirectingDashboard: 'Te llevamos a tu panel…',
    linkEyebrow: 'Vincular correo',
    linkTitle: 'Agrega este correo a',
    linkBody:
      'Confirma que es tuyo y podrás iniciar sesión en tu cuenta con él.',
    linkCta: 'Confirmar correo',
    linking: 'Confirmando…',
    linkedTitle: 'Correo vinculado',
    linkMergeTitle: 'Este correo ya tiene una cuenta',
    redirectingAccount: 'Te llevamos a tu cuenta…',
    redirectingMerge: 'Te llevamos a unir las dos cuentas…',
    invalidEyebrow: 'Enlace no disponible',
    invalidTitle: 'Este enlace venció',
    invalidBody:
      'Los enlaces de acceso funcionan una sola vez y vencen a los 15 minutos. Pide uno nuevo para continuar.',
    requestNew: 'Pedir un enlace nuevo',
    poweredBy: 'Impulsado por'
  }
}
