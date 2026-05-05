import Image from 'next/image'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

const apiDocsUrl = process.env.NEXT_PUBLIC_API_DOCS_URL ?? '/api-docs'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <Image
            src="/logos/lawallet.svg"
            alt="LaWallet"
            width={120}
            height={22}
            className="dark:invert-0"
            priority
          />
        </div>
      ),
    },
    links: [
      {
        text: 'API Playground',
        url: apiDocsUrl,
        external: apiDocsUrl.startsWith('http'),
      },
    ],
    githubUrl: 'https://github.com/lawalletio/lawallet-nwc',
  }
}
