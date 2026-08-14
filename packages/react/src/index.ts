// @lawallet-nwc/react
// React provider + hooks for LaWallet NWC instances, built on @lawallet-nwc/sdk.

export {
  LaWalletProvider,
  useLaWalletContext,
  type LaWalletProviderProps,
  type LaWalletContextValue,
  type AuthState,
  type AuthStatus,
  type LoginMethod
} from './provider'

export { useAuth } from './use-auth'

export {
  useLaWallet,
  useInstanceInfo,
  useSSEConnected,
  useUser,
  useAddresses,
  useAddress,
  useUsernameAvailability,
  useAddressInvoices,
  useRemoteWallets
} from './hooks'

export {
  useClaimAddress,
  USERNAME_RE,
  type ClaimAddressState,
  type ClaimAddressStep,
  type UseClaimAddressOptions
} from './use-claim-address'

export { useResource, type ResourceState } from './use-resource'
export { ResourceStore } from './store'

// Re-export the SDK surface so app code needs a single import.
export * from '@lawallet-nwc/sdk'
