// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-5535
'use client'

import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      closeButton
      // On phones, lift toasts above the fixed bottom tab bar (h-14 = 3.5rem)
      // plus the safe-area inset and a small gap, so they don't overlap it.
      // Desktop positioning is unchanged.
      mobileOffset={{
        bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 1rem)'
      }}
      toastOptions={{
        closeButtonAriaLabel: 'Dismiss toast',
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          closeButton:
            'group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border group-[.toast]:hover:bg-muted',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
