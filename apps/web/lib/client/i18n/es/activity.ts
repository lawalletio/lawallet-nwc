import type { activity as En } from '../en/activity'

export const activity: typeof En = {
  title: 'Actividad',
  all: 'Todo',
  transfers: 'Transferencias',
  connectWallet:
    'Conecta una billetera para ver tu historial de transacciones.',
  loading: 'Cargando actividad…',
  loadFailed: 'No se pudo cargar la actividad',
  loadMoreFailed: 'No se pudo cargar más',
  empty: 'Todavía no hay actividad.',
  end: 'Llegaste al final.',
  loadingMore: 'Cargando más…',
  loadMore: 'Cargar más',
  today: 'Hoy',
  yesterday: 'Ayer',
  detail: {
    loading: 'Cargando transacción…',
    notFound: 'Transacción no encontrada.',
    backToActivity: 'Volver a la actividad',
    pending: 'Pago pendiente',
    failed: 'Pago fallido',
    received: 'Pago recibido',
    sent: 'Pago enviado',
    note: 'Nota',
    time: 'Hora',
    to: 'Para',
    networkFee: 'Comisión de red',
    paymentHash: 'Hash del pago',
    preimage: 'Preimagen'
  }
}
