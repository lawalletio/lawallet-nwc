/**
 * Public entry point for the wallet driver layer. Importing this file once
 * (e.g. from a route handler or the server bootstrap) registers every
 * built-in driver. Tests import the registry directly and can register
 * stubs without pulling in real drivers.
 */
import { nwcDriver } from './nwc-driver'
import { registerDriver } from './registry'

registerDriver(nwcDriver)

export type {
  BalanceResult,
  MakeInvoiceInput,
  MakeInvoiceResult,
  PayInvoiceInput,
  PayInvoiceResult,
  RemoteWalletDriver,
  WalletOperationContext
} from './types'
export {
  DriverConfigError,
  DriverError,
  DriverRemoteError,
  PaymentOutcomeUnknownError,
  PaymentRejectedError,
  UnsupportedDriverError
} from './errors'
export {
  driverForWallet,
  getDriver,
  listDriverTypes,
  registerDriver,
  unregisterDriver
} from './registry'
export {
  getInFlightDirectPayment,
  nwcDriver,
  reconcileDirectNwcPayment
} from './nwc-driver'
export type { NwcDriverConfig } from './nwc-driver'
