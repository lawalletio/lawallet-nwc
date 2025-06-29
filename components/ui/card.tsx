import * as React from "react"

import { cn } from "@/lib/utils"
import { useWallet } from "@/providers/wallet"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  ),
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { lightningAddress } = useWallet()

    if (!lightningAddress) {
      return (
        <div ref={ref} className={cn("text-lg font-medium", className)} {...props}>
          <span className="text-gray-400">user</span>
          <span className="text-purple-400 font-bold text-xl">@</span>
          <span className="text-blue-400">example.com</span>
        </div>
      )
    }

    const [username, domain] = lightningAddress.split("@")

    return (
      <div ref={ref} className={cn("text-lg font-medium tracking-wide", className)} {...props}>
        <span className="text-white font-semibold">{username}</span>
        <span className="text-purple-400 font-bold text-xl mx-1 drop-shadow-lg">@</span>
        <span className="text-blue-400 font-medium">{domain}</span>
      </div>
    )
  },
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
