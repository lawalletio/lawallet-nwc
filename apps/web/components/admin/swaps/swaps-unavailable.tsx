import { ArrowLeftRight } from 'lucide-react'

export function SwapsUnavailable() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <ArrowLeftRight className="size-8 text-muted-foreground" />
      <p className="font-medium">Swaps are not available</p>
      <p className="text-sm text-muted-foreground">
        An administrator needs to enable Bull Bitcoin or Wapu in Integrations.
      </p>
    </div>
  )
}
