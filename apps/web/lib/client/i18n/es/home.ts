import type { home as En } from '../en/home'

export const home: typeof En = {
  account: 'Cuenta',
  accountWithKey: (short: string) => `Cuenta · ${short}`,
  adminDashboard: 'Panel de administración',
  logOut: 'Cerrar sesión',
  communityLogoAlt: 'Comunidad',
  showBalance: 'Mostrar saldo',
  hideBalance: 'Ocultar saldo',
  yourBalance: 'Tu saldo',
  bonusNote: (sats: string) => `Incluye ${sats} sats por activar tu tarjeta.`,
  dismissBonus: 'Descartar nota del bono de tarjeta',
  receive: 'Recibir',
  send: 'Enviar',
  address: 'Dirección',
  claimAddress: 'Reclama tu dirección Lightning gratis',
  autoCreateTitle: 'Tu billetera se crea cuando recibes',
  autoCreateBody:
    'No hace falta configurar nada: toca Recibir y crearemos una billetera automáticamente para tu primer pago.',
  noWalletTitle: 'No hay billetera conectada',
  noWalletBody:
    'Conecta una URI de Nostr Wallet Connect para empezar a enviar y recibir.',
  connectWallet: 'Conectar una billetera',
  activityTitle: 'Actividad',
  viewAll: 'Ver todo',
  list: {
    activity: {
      connect: 'Conecta una billetera para ver tu actividad.',
      loading: 'Cargando actividad…',
      error: 'No se pudo cargar la actividad.',
      empty: 'Todavía no hay actividad.'
    }
  },
  install: {
    nativeTitle: 'Instala la billetera',
    nativeBody: 'Agrégala a tu pantalla de inicio para acceder rápido.',
    iosTitle: 'Agrégala a tu pantalla de inicio',
    iosBody:
      'Toca Compartir y luego Agregar a inicio. Puedes seguir usando la billetera de todos modos.',
    install: 'Instalar',
    dismiss: 'Cerrar aviso de instalación'
  }
}
