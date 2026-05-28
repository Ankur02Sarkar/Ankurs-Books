import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: "Ankur's Books — Rig Veda",
    template: "%s | Ankur's Books",
  },
  description:
    'A digital library of the Rig Veda — ten Mandalas, 1,028 hymns, with audio narration by Kokoro AI.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      {/* Inline script: read localStorage before first paint to avoid flash */}
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-dvh flex flex-col bg-background text-foreground antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
