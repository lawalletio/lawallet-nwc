import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

interface NwcLnWidgetProps {
  nwcUri?: string
  lightningAddress?: string
  hiddenWhenFilled?: boolean
  isNWCConnected?: boolean
}

export function NwcLnWidget({
  nwcUri,
  lightningAddress,
  hiddenWhenFilled = true,
  isNWCConnected = false
}: NwcLnWidgetProps) {
  const router = useRouter()

  return (
    <div className="overflow-hidden first-letter:lex flex-col gap-[1px] bg-border border rounded-xl backdrop-blur-sm">
      <div className="flex items-center justify-between p-4 bg-black">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-medium text-white">Nostr Wallet Connect</div>
            {nwcUri ? (
              <div className="flex items-center gap-2 text-sm">
                <div
                  className={`size-2 rounded-full ${isNWCConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}
                ></div>
                <p className="text-muted-foreground">
                  {isNWCConnected ? 'Connected' : 'Offline'}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-muted-foreground"></div>
                <p className="text-muted-foreground">Not configured</p>
              </div>
            )}
          </div>
        </div>
        {(!nwcUri || !hiddenWhenFilled) && (
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              onClick={() => router.push('/wallet/setup/nwc')}
            >
              Setup
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between p-4 bg-black">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-medium text-white">Lightning Address</div>
            {lightningAddress ? (
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-green-400 animate-pulse"></div>
                <p className="text-muted-foreground">Connected</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-muted-foreground"></div>
                <p className="text-muted-foreground">Not configured</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(!lightningAddress || !hiddenWhenFilled) && (
            <Button
              variant="default"
              disabled={!nwcUri}
              onClick={() => router.push('/wallet/setup/lightning-address')}
            >
              Setup
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
