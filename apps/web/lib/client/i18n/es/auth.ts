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
      'Tu proveedor de passkeys no puede crear la clave que LaWallet necesita. Usa el Administrador de contraseñas de Google o el Llavero de iCloud, o inicia sesión de otra forma.',
    'foreign-passkey':
      'Esta passkey pertenece a otra aplicación, así que LaWallet no puede iniciar sesión con ella. Usa una passkey de LaWallet o inicia sesión de otra forma.',
    'import-blocked':
      'Tu navegador no pudo acceder aquí a las passkeys de ese dominio. El dominio debe autorizar la dirección de este sitio y tu navegador debe admitir passkeys entre sitios. Elige otro origen u otra forma de ingresar.',
    'import-derived':
      'Esta passkey crea su clave por sí misma, así que no se puede pasar a LaWallet. Exporta la clave desde la otra aplicación e inicia sesión con ella.',
    'import-unsupported':
      'LaWallet no puede leer la clave de esta passkey. Exporta la clave desde la otra aplicación e inicia sesión con ella.',
    'stored-key-missing':
      'No se encontró la clave de esta passkey. LaWallet no creó una cuenta nueva.',
    'stored-key-invalid':
      'La clave guardada con esta passkey no coincide con ella, así que LaWallet no la usará.',
    'store-failed':
      'Tu proveedor de passkeys no pudo guardar la clave, así que no se guardó nada. Puedes borrar la nueva passkey de LaWallet de tu proveedor y probar con otro.',
    'key-owned':
      'Esta clave ya pertenece a otra cuenta de LaWallet. Cierra sesión e inicia sesión con ella.'
  },
  passkeyImport: {
    thisApp: 'LaWallet',
    manualDomain: 'Otro dominio',
    domainLabel: 'Dominio de la passkey',
    domainHint: 'Ingresa el dominio donde creaste tu passkey.',
    invalidDomain:
      'Ingresa un dominio como passkeys.example.com, sin URL ni ruta.',
    providerSourceNotice:
      'Firmar con un proveedor mantiene la clave allí. Recuperar desde una copia permite que LaWallet lea la clave; hazlo solo si confías en esta app.',
    backupFile: 'Copia de cuenta Nosskey',
    backupInvalid: 'Elige una copia válida (hasta 8 KB).',
    rememberBackup:
      'Recordar esta cuenta y su copia cifrada en este dispositivo',
    providerNotice:
      'Tu proveedor conserva la clave de firma. La conexión termina al cerrar sesión o recargar.',
    signWithProvider: (label: string) => `Firmar con ${label}`,
    searchSources: 'Buscar apps o ingresar un dominio',
    accessNotice: 'Al desbloquear, compartes tu clave de firma con LaWallet.',
    temporaryBody:
      'Usa esta cuenta durante esta sesión. Al recargar o cerrar sesión se bloquea de nuevo. Puedes añadir una passkey de LaWallet después en Seguridad.',
    rememberAccount: 'Recordar esta cuenta en este dispositivo',
    useThisTime: 'Usar esta vez',

    open: 'Usar una passkey de otra aplicación',
    title: 'Usar una passkey de otra aplicación',
    subtitle:
      'Trae la cuenta de Nostr que guarda una passkey de otra aplicación.',
    chooseSource: 'Elige la aplicación de tu passkey',
    pickAccount:
      'Esta passkey guarda varias cuentas. Elige la que quieres usar.',
    account: (n: number) => `Cuenta ${n}`,
    defaultAccount: 'Predeterminada',
    confirmTitle: '¿Es tu cuenta?',
    confirmBody: 'Revisa que sea la cuenta que quieres usar aquí.',
    confirm: 'Sí, es mi cuenta',
    choiceTitle: '¿Cómo quieres iniciar sesión la próxima vez?',
    keepTitle: 'Seguir usando esta passkey',
    keepBody:
      'LaWallet desbloquea tu clave para cada sesión con la passkey de la otra aplicación. No crea una passkey nueva. Si esa aplicación retira el acceso, usa otro método de recuperación.',
    copyTitle: 'Crear una passkey de LaWallet',
    copyBody:
      'LaWallet guarda su propia copia en una passkey nueva. Funciona sin la otra aplicación, pero ahora hay dos copias que cuidar.',
    continue: 'Continuar',
    kept: 'Listo. Desde ahora inicia sesión con esta passkey.',
    rememberedTitle: 'Passkey de otra aplicación',
    rememberedBody:
      'Este dispositivo inicia sesión con ella. LaWallet no tiene una copia en passkey.',
    forget: 'Olvidarla en este dispositivo',
    forgotten: 'Olvidada en este dispositivo.',
    useAnother: 'Usar otra passkey',
    pickAgain:
      'Esta passkey ya no tiene la cuenta que usaste antes. Elige una.',
    notMine: 'No es mi cuenta',
    waiting: 'Esperando a tu dispositivo…',
    saved: 'Passkey guardada. Úsala para iniciar sesión desde ahora.'
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
