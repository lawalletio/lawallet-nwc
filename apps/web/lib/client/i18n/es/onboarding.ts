import type { onboarding as En } from '../en/onboarding'

export const onboarding: typeof En = {
  landing: {
    tagline:
      'Guarda y administra tus sats, experiencias e identidad Lightning en un solo lugar.',
    createAccount: 'Crear cuenta',
    login: 'Iniciar sesión'
  },
  login: {
    title: 'Iniciar sesión',
    subtitle: 'Entra con una passkey o con tus credenciales de Nostr.',
    passkey: 'Continuar con passkey',
    or: 'o',
    continueWithNostr: 'Continuar con Nostr',
    newHere: '¿Nuevo en LaWallet?',
    createAccount: 'Crear una cuenta'
  },
  nostr: {
    title: 'Continuar con Nostr',
    subtitle: 'Elige cómo quieres conectar tu clave de Nostr.',
    submit: 'Iniciar sesión',
    loading: 'Iniciando sesión...'
  },
  signup: {
    title: 'Crea tu cuenta',
    subtitlePasskey:
      'Usa una passkey para empezar de la forma más simple, o elige una clave de Nostr si ya conoces el tema.',
    subtitleNostr:
      'LaWallet usa Nostr para tu identidad. Elige cómo quieres iniciar sesión.',
    passkey: 'Crear con passkey',
    randomKey: 'Crear una clave aleatoria',
    haveKey: 'Ya tengo una clave'
  },
  createAccount: {
    title: 'Crear cuenta',
    subtitle:
      'Generamos una clave privada para tu nueva billetera. Guárdala en un lugar seguro: si la pierdes, pierdes el acceso a tu cuenta.',
    confirmLabel:
      'Guardé mi clave privada. Entiendo que si la pierdo, perderé el acceso a mi cuenta.',
    creating: 'Creando cuenta...',
    failed: 'No se pudo crear la cuenta'
  },
  passkey: {
    title: 'Crear con passkey',
    subtitle: community =>
      `Tu dispositivo crea una passkey${community ? ` para ${community}` : ''} con Face ID, Touch ID o el bloqueo de pantalla. Sin contraseñas, nada que anotar.`,
    benefitBiometric:
      'Inicia sesión solo con tu huella, tu rostro o el PIN del dispositivo.',
    benefitSync:
      'Funciona en todos tus dispositivos: las passkeys sincronizadas inician sesión en cualquier lugar, y cualquier navegador puede usar un teléfono mediante QR.',
    benefitKey:
      'Tu clave de Nostr se deriva de la propia passkey: la misma clave en cada dispositivo donde se sincroniza, nunca guardada en un servidor.',
    cancelled: 'Se cerró la ventana de la passkey. Inténtalo de nuevo',
    waiting: 'Esperando a tu dispositivo…',
    submit: 'Crear mi cuenta'
  },
  welcome: {
    title: 'Bienvenido a LaWallet',
    body: 'Esta billetera es parte de una plataforma comunitaria de autocustodia construida sobre Lightning y Nostr. Tú tienes tus propias claves, y cada pago pasa por tu conexión Nostr Wallet Connect.',
    thingsToKnow: 'Algunas cosas que debes saber',
    tipKey: 'Tu clave privada nunca sale de este dispositivo.',
    tipAddress:
      'Puedes reclamar una dirección Lightning gratis dentro de la billetera.',
    tipSats: 'Envía y recibe sats sin un custodio.',
    enter: 'Entrar a la billetera'
  }
}
