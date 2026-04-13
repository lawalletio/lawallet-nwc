import { RootProvider } from 'fumadocs-ui/provider/next';
import { SandPackCSS } from '@/components/sandpack-styles';
import './global.css';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'LaWallet NWC Docs',
    template: '%s | LaWallet NWC',
  },
  description:
    'Open-source Lightning Address platform with Nostr Wallet Connect. Interactive documentation with live examples.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <SandPackCSS />
        <link rel="icon" href="/logos/lawallet.svg" type="image/svg+xml" />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{
            defaultTheme: 'dark',
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
