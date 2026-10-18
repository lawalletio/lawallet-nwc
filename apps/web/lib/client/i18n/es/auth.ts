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
  goHome: 'Ir al inicio'
}
