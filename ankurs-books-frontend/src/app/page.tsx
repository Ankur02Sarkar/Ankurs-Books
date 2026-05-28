import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'
import { getAllBooks } from '@/lib/rigveda'
import { ROMAN } from '@/types/rigveda'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, SpeakerIcon } from '@hugeicons/core-free-icons'

export const metadata = {
  title: "Ankur's Books — Rig Veda",
  description:
    'A digital library of the Rig Veda — ten Mandalas, 1,028 hymns, with audio narration by Kokoro AI.',
}

export default async function HomePage() {
  const books = await getAllBooks()

  const totalHymns = books.reduce((sum, b) => sum + b.hymns.length, 0)
  const hymnsWithAudio = books.reduce(
    (sum, b) => sum + b.hymns.filter((h) => h.audio_url).length,
    0,
  )

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {/* Hero */}
        <div className="mb-12 max-w-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            Digital Library
          </p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Rig Veda
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Ten Mandalas &middot; {totalHymns.toLocaleString()} Hymns
          </p>
          {hymnsWithAudio > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <HugeiconsIcon
                icon={SpeakerIcon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
                className="text-primary"
              />
              {hymnsWithAudio.toLocaleString()} hymns with audio narration
            </p>
          )}
        </div>

        {/* Book grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {books.map((book) => {
            const roman = ROMAN[book.bookNum] ?? String(book.bookNum)
            const withAudio = book.hymns.filter((h) => h.audio_url).length

            return (
              <Link
                key={book.bookNum}
                href={`/book/${book.bookNum}`}
                className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                {/* Mandala label */}
                <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Mandala {roman}
                </span>

                {/* Book title */}
                <div className="flex-1">
                  <p className="text-sm font-semibold text-card-foreground leading-snug">
                    Book {book.bookNum}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {book.hymns.length} hymns
                  </p>
                  {withAudio > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
                      <HugeiconsIcon
                        icon={SpeakerIcon}
                        size={11}
                        color="currentColor"
                        strokeWidth={1.5}
                      />
                      {withAudio} with audio
                    </p>
                  )}
                </div>

                {/* Open arrow */}
                <div className="flex items-center gap-1 text-xs font-medium text-primary">
                  Open
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={13}
                    color="currentColor"
                    strokeWidth={2}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </div>
              </Link>
            )
          })}
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Text from{' '}
        <a
          href="https://sacred-texts.com/hin/rigveda/index.htm"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Sacred Texts Archive
        </a>
        {' · '}Audio by Kokoro AI
      </footer>
    </>
  )
}
