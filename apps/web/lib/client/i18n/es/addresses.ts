import type { addresses as En } from '../en/addresses'

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const addresses: typeof En = {
  paymentHash: 'Hash del pago',
  destination: 'Destino',
  destinationInvoice: 'Factura de destino',
  attemptNo: (n: number) => `Intento #${n}`,
  invoiceDetails: {
    stillBlocked: 'El reenvío sigue bloqueado',
    completed: 'Reenvío completado',
    retryStarted: 'Reintento de reenvío iniciado',
    retryFailed: 'No se pudo reintentar el reenvío',
    destinationUpdated: 'Destino actualizado — listo para reintentar',
    changeFailed: 'No se pudo cambiar el destino',
    proxyTitle: 'Detalle del pago proxy',
    title: 'Detalle de la factura',
    routedTo: (destination: string) =>
      `Recibido en esta dirección y reenviado a ${destination}.`,
    paymentPath: 'Ruta del pago',
    serviceFeePct: (pct: string) => `${pct}% de comisión de servicio`,
    received: 'Recibido',
    incomingInvoice: 'Factura entrante',
    serviceFee: 'Comisión de servicio',
    bpsRetained: (bps: number) => `${bps} bps retenidos`,
    forwarded: 'Reenviado',
    reservedToForward: 'Reservado para reenviar',
    routingFeeByProxy: 'Comisión de ruteo pagada por la billetera proxy',
    notChargedYet: 'Aún no cobrada',
    needsAttention: 'El reenvío requiere atención',
    retryForwarding: 'Reintentar reenvío',
    changeAddress: 'Cambiar dirección',
    newAddress: 'Nueva dirección Lightning',
    saveDestination: 'Guardar destino',
    rerouteNote:
      'Solo se redirige este pago. Los pagos futuros mantienen el destino actual de la dirección.',
    invoices: 'Facturas',
    bothLegs: 'Tramos de recepción y destino',
    receiveLeg: 'Tramo de recepción',
    settlement: 'Liquidación',
    forwardingAttempts: (n: number) =>
      plural(n, 'intento de reenvío', 'intentos de reenvío'),
    sourceSettled: 'Origen liquidado',
    forwardedAmount: 'Monto reenviado',
    notForwarded: 'No reenviado',
    retries: 'Reintentos',
    zapReceipt: 'Recibo de zap',
    published: (date: string) => `Publicado ${date}`,
    notPublished: 'No publicado',
    updated: 'Actualizado',
    zapReceiptEvent: 'Evento del recibo de zap',
    attemptHistory: 'Historial de intentos',
    latestOf: (shown: number, total: number) => `Últimos ${shown} de ${total}`,
    notRecorded: 'Sin registrar',
    expectedAmount: (amount: string) =>
      `Monto esperado ${amount}. Ninguna factura de destino válida llegó a la cola de reenvío.`,
    destinationInvoiceNo: (n: number) => `Factura de destino · #${n}`,
    created: 'Creada',
    resolved: 'Resuelta',
    notYet: 'Todavía no'
  },
  invoicesCard: {
    title: 'Facturas recientes',
    refresh: 'Actualizar facturas',
    loadFailed: 'No se pudieron cargar las facturas.',
    empty: 'Todavía no hay facturas.',
    fallbackLine: 'Pago Lightning',
    viewDetails: (name: string) => `Ver detalle de ${name}`,
    status: { PAID: 'pagada', PENDING: 'pendiente', EXPIRED: 'vencida' }
  },
  protocols: {
    label: 'Protocolos de recepción',
    servedBy: (provider: string) => ` vía ${provider}`,
    notChecked: 'Aún no verificado.',
    lud16Yes: (served: string) => `Resuelve un payRequest${served}.`,
    lud16No: 'Esta dirección no resuelve un payRequest.',
    nip05Yes: 'Publicada en el nostr.json de este dominio.',
    nip05No: 'La cuenta no tiene una clave pública de Nostr utilizable.',
    lud12Yes: (served: string) =>
      `Quien paga puede adjuntar un comentario${served}.`,
    lud12No: 'No se aceptan comentarios de quien paga.',
    lud21Proxy:
      'Las facturas proxy exponen una URL de verificación de liquidación.',
    lud21Yes: (served: string) =>
      `Las facturas emitidas exponen una URL de verificación de liquidación${served}.`,
    lud21No: 'Las facturas emitidas no exponen URL de verificación.',
    nip57Proxy: 'Los recibos proxy se firman y publican tras la liquidación.',
    nip57Alias: (served: string) =>
      `Anunciado${served} · ese proveedor firma los recibos.`,
    nip57Yes: 'Las facturas de zap liquidadas publican un recibo firmado.',
    nip57Unavailable:
      'No disponible hasta que la detección de liquidación y un firmante de recibos estén listos.'
  },
  workspace: {
    sections: 'Secciones de la dirección proxy',
    overview: 'Resumen',
    paymentsReceived: 'Pagos recibidos',
    payments: 'Pagos',
    activity: 'Actividad'
  },
  forwardingActivity: {
    title: 'Actividad de reenvío',
    description:
      'Liquidación de recepción, intentos al destino, reintentos y errores del listener.',
    payments: 'Pagos',
    attempts: 'Intentos',
    needsAttention: 'Requieren atención',
    unavailableTitle: 'Actividad no disponible',
    unavailableBody: 'No se pudo cargar el registro de reenvíos.',
    emptyTitle: 'Todavía no hay actividad proxy',
    emptyBody: 'Los intentos aparecerán cuando se reciba el primer pago.',
    recordedRetries: (n: number) =>
      `${n.toLocaleString()} ${n === 1 ? 'reintento registrado' : 'reintentos registrados'} en estos pagos.`,
    paymentReceived: 'Pago recibido',
    leaseExpires: (date: string) => `El lease vence ${date}`,
    workerLease: 'Lease del worker',
    net: (amount: string) => `Neto ${amount}`,
    destinationAttempts: 'Intentos al destino',
    counts: (attempts: number, retries: number) =>
      `${plural(attempts, 'intento', 'intentos')} · ${plural(retries, 'reintento', 'reintentos')}`,
    latestError: 'Último error de reenvío',
    noAttempt:
      'No se registró ningún intento de factura de destino. Próximo reintento:',
    initialForward: 'Reenvío inicial',
    retryNo: (n: number) => `Reintento #${n}`,
    routingFee: (amount: string) => `Comisión de ruteo ${amount}`,
    updatedAgo: (relative: string) => `Actualizado ${relative}`,
    forwardingError: 'Error de reenvío',
    notAccepted: 'El intento saliente no fue aceptado.',
    requestId: 'ID de solicitud'
  },
  pendingBalance: {
    forwarded: (n: number) =>
      n === 1
        ? '1 pago pendiente reenviado'
        : `${n} pagos pendientes reenviados`,
    stillNeedsAttention: 'El reenvío sigue requiriendo atención',
    started: 'Reenvío de pendientes iniciado',
    failed: 'No se pudieron reenviar los fondos pendientes',
    label: 'Saldo proxy pendiente',
    title: 'Saldo pendiente',
    blocked: (n: number) => `${n} ${n === 1 ? 'bloqueado' : 'bloqueados'}`,
    resolving: (n: number) => `${n} resolviendo`,
    unavailable: 'Saldo pendiente no disponible',
    netAcross: (n: number) =>
      `Monto neto de ${plural(n, 'pago', 'pagos')}, después de comisiones de servicio.`,
    allForwarded: 'Todos los pagos proxy confirmados fueron reenviados.',
    noDestination: 'Sin destino configurado',
    oldestPending: (relative: string) => `Pendiente más antiguo ${relative}`,
    configuredDestination: 'Destino configurado',
    forwardingAria: 'Los fondos pendientes se están reenviando',
    forwardAria: 'Reenviar fondos pendientes',
    inProgressHint: 'Ya hay un pago saliente en curso o esperando confirmación',
    forwardHint: 'Reenviar ahora todos los fondos proxy pendientes',
    forwarding: 'Reenviando',
    starting: 'Iniciando',
    forwardPending: 'Reenviar pendientes',
    refresh: 'Actualizar saldo pendiente'
  },
  createProxy: {
    created: 'Billetera proxy creada',
    enableFailed: 'No se pudo activar el reenvío',
    title: 'Crear billetera proxy',
    description:
      'Elige una billetera NWC existente que pueda enviar y recibir, o conecta una nueva, y luego elige su primer destino de reenvío.',
    sourceWallet: 'Billetera de origen',
    selectWallet: 'Elige una billetera',
    needNew: '¿Necesitas una nueva?',
    entryFee: 'Comisión de entrada (%)',
    baseFee: 'Comisión base (sats)',
    enable: 'Activar proxy'
  }
}
