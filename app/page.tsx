import Image from 'next/image'

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background">
      <Image
        src="/logos/lawallet.svg"
        alt="LaWallet"
        width={180}
        height={40}
        priority
      />
      <p className="mt-6 text-muted-foreground">
        Landing under construction
      </p>
    </div>
  )
}
