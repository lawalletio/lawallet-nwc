import type { shared as En } from '../en/shared'

export const shared: typeof En = {
  goBack: 'Volver',
  nav: {
    label: 'Acciones de la billetera',
    home: 'Inicio',
    settings: 'Ajustes',
    scan: 'Escanear QR'
  },
  balance: {
    unavailable: 'No disponible',
    loading: 'Cargando saldo'
  },
  tx: {
    received: 'Recibido',
    sent: 'Enviado',
    justNow: 'Ahora',
    minutesAgo: (n: number) => `hace ${n} min`,
    hoursAgo: (n: number) => `hace ${n} h`,
    daysAgo: (n: number) => `hace ${n} d`
  },
  pagination: {
    label: (label: string) => `Paginación de ${label}`,
    page: (n: number) => `Página ${n}`,
    previous: 'Anterior',
    next: 'Siguiente',
    previousPage: (label: string) => `Página anterior de ${label}`,
    nextPage: (label: string) => `Página siguiente de ${label}`
  },
  relay: {
    badge: 'Error del relay: toca para ver detalles',
    offline: 'Sin conexión',
    title: 'Relay de la billetera no disponible',
    generic:
      'Falló la última solicitud al relay de la billetera. La billetera seguirá reintentando en segundo plano.',
    timeout:
      'El relay de la billetera no respondió a tiempo. Revisa el dispositivo donde está tu billetera o tu conexión a internet.',
    unreachable:
      'No se pudo conectar con el relay de la billetera. Revisa tu conexión a internet e inténtalo de nuevo.'
  },
  receipt: {
    shareTitle: 'Comprobante de pago',
    copied: 'Comprobante copiado',
    shareFailed: 'No se pudo compartir el comprobante',
    pending: 'Pendiente',
    failed: 'Fallido',
    settled: 'Completado',
    unavailable: 'No disponible',
    proofTitle: 'Prueba de pago',
    proofHint: 'Muéstralos o cópialos solo cuando necesites un comprobante.',
    notProvided: 'No proporcionado por la billetera',
    show: (label: string) => `Mostrar ${label.toLowerCase()}`,
    hide: (label: string) => `Ocultar ${label.toLowerCase()}`,
    viewActivity: 'Ver actividad',
    text: {
      title: 'Comprobante de pago de LaWallet',
      status: 'Estado',
      amount: 'Monto',
      fee: 'Comisión',
      to: 'Para',
      destination: 'Destino',
      note: 'Nota',
      time: 'Hora',
      paymentHash: 'Hash del pago',
      preimage: 'Preimagen'
    }
  },
  qr: {
    copyFailed: 'No se pudo copiar'
  },
  forwarding: {
    busy: 'Reenvío del pago en curso',
    statuses: {
      COMPLETED: 'Completado',
      SUCCEEDED: 'Exitoso',
      PAID: 'Pagado',
      SETTLED: 'Liquidado',
      RETAINED: 'Retenido',
      BLOCKED: 'Bloqueado',
      REJECTED: 'Rechazado',
      EXPIRED: 'Vencido',
      FAILED: 'Fallido',
      RECEIVED: 'Recibido',
      FORWARDING: 'Reenviando',
      AWAITING_FORWARDING: 'Esperando reenvío',
      PARTIAL: 'Parcial',
      PENDING: 'Pendiente',
      READY: 'Listo',
      UNKNOWN: 'Desconocido'
    }
  },
  protocol: {
    notChecked: 'Sin verificar',
    supported: 'Compatible',
    notSupported: 'No compatible',
    onThisAddress: 'En esta dirección',
    useCases: 'Qué permite',
    specification: 'Especificación',
    openDetails: (label: string, state: string) =>
      `${label} — ${state}. Abrir detalles`,
    clickForDetails: 'haz clic para ver detalles'
  },
  keypad: {
    label: 'Teclado de monto',
    deleteLast: 'Borrar último dígito',
    enter: (key: string) => `Ingresar ${key}`
  },
  currencyToggle: 'Moneda de visualización',
  addressInput: {
    options: 'Opciones de dirección Lightning',
    saved: 'Guardadas',
    suggestions: 'Sugerencias',
    change: 'Cambiar'
  }
}
