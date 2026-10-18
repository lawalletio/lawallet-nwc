import type { common as En } from '../en/common'

export const common: typeof En = {
  back: 'Atrás',
  cancel: 'Cancelar',
  close: 'Cerrar',
  continue: 'Continuar',
  copy: 'Copiar',
  copied: 'Copiado',
  done: 'Listo',
  retry: 'Reintentar',
  share: 'Compartir',
  loading: 'Cargando…',
  sats: (n: string) => `${n} sats`
}
