/**
 * LUD-21 (LNURL verify) client-side polling utility.
 *
 * After a Lightning invoice is generated via LUD-06, the response may include
 * a `verify` URL. Polling this URL returns the payment status and preimage.
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/21.md
 */

export interface VerifyResult {
  settled: boolean
  preimage?: string
  pr?: string
}

/**
 * Polls a LUD-21 verify URL until the invoice is settled or the timeout is reached.
 *
 * @param verifyUrl - The verify URL from the LUD-06 callback response
 * @param opts.interval - Polling interval in ms (default: 3000)
 * @param opts.timeout - Maximum wait time in ms (default: 300000 = 5 min)
 * @param opts.signal - AbortSignal for cancellation (e.g., on component unmount)
 * @returns The verify result with settled=true and the preimage
 */
export function pollVerifyUrl(
  verifyUrl: string,
  opts?: { interval?: number; timeout?: number; signal?: AbortSignal }
): Promise<VerifyResult> {
  const interval = opts?.interval ?? 3000
  const timeout = opts?.timeout ?? 300_000

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>
    let timeoutTimer: ReturnType<typeof setTimeout>

    function cleanup() {
      clearInterval(timer)
      clearTimeout(timeoutTimer)
    }

    // Handle abort signal
    if (opts?.signal) {
      if (opts.signal.aborted) {
        reject(new Error('Polling aborted'))
        return
      }
      opts.signal.addEventListener('abort', () => {
        cleanup()
        reject(new Error('Polling aborted'))
      })
    }

    // Timeout
    timeoutTimer = setTimeout(() => {
      cleanup()
      reject(new Error('Payment verification timed out'))
    }, timeout)

    // Poll
    async function check() {
      try {
        const res = await fetch(verifyUrl)
        if (!res.ok) return

        const data: VerifyResult = await res.json()
        if (data.settled) {
          cleanup()
          resolve(data)
        }
      } catch {
        // Network error — keep polling
      }
    }

    // First check immediately
    check()
    timer = setInterval(check, interval)
  })
}

/**
 * Single-shot LUD-21 verify check. Used for manual "I've paid — check now"
 * recovery and after a WebLN payment, independent of the long-lived poller.
 *
 * Resolves with the verify result (which may report `settled: false` if the
 * payment hasn't landed yet). Rejects only on a network / HTTP failure so the
 * caller can distinguish "not paid yet" from "couldn't reach the verifier".
 */
export async function checkVerifyOnce(verifyUrl: string): Promise<VerifyResult> {
  const res = await fetch(verifyUrl)
  if (!res.ok) {
    throw new Error(`Verify request failed (${res.status})`)
  }
  return (await res.json()) as VerifyResult
}
