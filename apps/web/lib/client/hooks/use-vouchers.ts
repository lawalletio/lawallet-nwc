'use client'

import {
  invalidateApiPath,
  useApi,
  useMutation,
  withQuery
} from '@/lib/client/hooks/use-api'

export type VoucherStatus = 'MINTED' | 'CLAIMED' | 'EXPIRED' | 'VOIDED'

/**
 * A `Benefit` from the coupons protocol. Modelled as a discriminated union so
 * the renderer is exhaustive, but every consumer must still handle an unknown
 * `type` — the upstream union grows and an instance running older code should
 * degrade to "we can't summarize this", never crash.
 */
export type VoucherBenefit =
  | { type: 'percent'; percent: number; productDs?: string[]; cap?: BenefitCap }
  | {
      type: 'fixed'
      amount: number
      currency: string
      productDs?: string[]
      cap?: BenefitCap
    }
  | {
      type: 'multibuy'
      buyQty: number
      payQty: number
      productDs?: string[]
      cap?: BenefitCap
    }
  | {
      type: 'buyXgetY'
      buyProductD: string
      giftProductD: string
      cap?: BenefitCap
    }
  | {
      type: 'freeItems'
      items: { d: string; qty: number }[]
      cap?: BenefitCap
    }

export interface BenefitCap {
  amount: number
  currency: string
}

/** Wire shape of `GET /api/wallet/vouchers` — mirrors `VoucherDto`. */
export interface Voucher {
  id: string
  nonce: string
  couponId: string | null
  name: string
  description: string | null
  imageUrl: string | null
  /** Merchant's offer page, when the issuer supplied one. */
  url: string | null
  merchantPubkey: string
  servicePubkey: string
  claimUrl: string
  mintUrl: string | null
  /** The protocol payload. `metadata.coupon` holds the benefit. */
  metadata: { coupon?: VoucherBenefit; [key: string]: unknown } | null
  /** The stored kind-20402 event, when the depositor sent one. */
  voucherEvent: Record<string, unknown> | null
  status: VoucherStatus
  expiresAt: string | null
  claimedAt: string | null
  statusCheckedAt: string | null
  depositedBy: string
  createdAt: string
}

export interface VoucherSettings {
  policy: 'ANYONE' | 'ALLOWLIST'
  allowlist: { pubkey: string; npub: string }[]
}

interface RefreshResult {
  voucher: Voucher
  /** False when the poll was skipped (terminal status or still cooling down). */
  checked: boolean
}

const LIST_PATH = '/api/wallet/vouchers'
const SETTINGS_PATH = '/api/wallet/vouchers/settings'

export function useVouchers(status?: VoucherStatus) {
  return useApi<Voucher[]>(withQuery(LIST_PATH, { status }))
}

export function useVoucher(id: string | null) {
  return useApi<Voucher>(id ? `${LIST_PATH}/${encodeURIComponent(id)}` : null)
}

export function useVoucherSettings() {
  return useApi<VoucherSettings>(SETTINGS_PATH)
}

export function useVoucherMutations() {
  const refresh = useMutation<void, RefreshResult>()
  const remove = useMutation<void, { deleted: boolean }>()
  const saveSettings = useMutation<
    { policy: VoucherSettings['policy']; allowlist: string[] },
    VoucherSettings
  >()

  return {
    /** Re-read one voucher's status from its coupon-manager service. */
    refreshVoucher: async (id: string) => {
      const result = await refresh.mutate(
        'post',
        `${LIST_PATH}/${encodeURIComponent(id)}/refresh`
      )
      invalidateApiPath(LIST_PATH)
      return result
    },

    deleteVoucher: async (id: string) => {
      await remove.mutate('del', `${LIST_PATH}/${encodeURIComponent(id)}`)
      invalidateApiPath(LIST_PATH)
    },

    saveVoucherSettings: async (input: {
      policy: VoucherSettings['policy']
      allowlist: string[]
    }) => {
      const saved = await saveSettings.mutate('put', SETTINGS_PATH, input)
      invalidateApiPath(SETTINGS_PATH)
      return saved
    },

    refreshing: refresh.loading,
    deleting: remove.loading,
    savingSettings: saveSettings.loading
  }
}
