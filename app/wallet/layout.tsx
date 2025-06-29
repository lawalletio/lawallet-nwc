"use client"

import type React from "react"

import { WalletProvider } from "@/providers/wallet"

export default function WalletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <WalletProvider>{children}</WalletProvider>
}
