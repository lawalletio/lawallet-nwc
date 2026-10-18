import type { withdraw as En } from '../en/withdraw'

export const withdraw: typeof En = {
  title: 'Retirar',
  cta: 'Retirar',
  ctaAmount: amount => `Retirar ${amount} sats`,
  fixedAmount: 'Monto fijo del voucher',
  range: (min, max) => `${min}–${max} sats`,
  from: 'Retirar de',
  voucher: 'Voucher Lightning',
  noWallet: 'No hay billetera conectada',
  noWalletBody:
    'Conecta una billetera que pueda recibir pagos para reclamar este voucher.',
  manageWallets: 'Administrar billeteras',
  celebration: {
    mute: 'Silenciar sonido del premio',
    unmute: 'Activar sonido del premio',
    eyebrowClaimed: '¡Tesoro reclamado!',
    eyebrowClaiming: 'Reclamo Lightning',
    won: '¡Ganaste!',
    onItsWay: 'Tu premio va en camino',
    opening: 'Abriendo el tesoro',
    pendingBody:
      'Ya lo reclamaste. Se sumarán a tu saldo cuando el remitente pague.',
    calling: amount => `Bajando ${amount} sats a puro rayo.`,
    srLanded: amount => `${amount} sats llegaron a tu billetera.`,
    srOnTheWay: amount => `${amount} sats van en camino.`,
    collect: '¡A cobrar!',
    replay: 'Repetir',
    listening: 'Esperando el pago',
    balance: 'Saldo',
    holding: 'En espera',
    pending: 'Pendiente',
    syncing: 'Sincronizando',
    meter: 'Saldo llenándose con los sats reclamados',
    before: amount => `Antes ${amount}`,
    claimed: amount => `Reclamado +${amount}`,
    chest: 'Cofre del tesoro abriéndose'
  }
}
