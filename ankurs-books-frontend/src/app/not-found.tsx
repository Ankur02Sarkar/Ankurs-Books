import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <p className="mb-2 font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mb-4 text-2xl font-bold text-foreground">Page not found</h1>
        <p className="mb-8 text-muted-foreground">
          This hymn or page does not exist in the library.
        </p>
        <Link
          href="/"
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-80"
        >
          Return to Library
        </Link>
      </main>
    </>
  )
}
