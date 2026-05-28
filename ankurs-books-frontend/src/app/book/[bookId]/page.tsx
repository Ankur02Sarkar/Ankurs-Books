import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getAllBooks, getBook } from '@/lib/rigveda'
import { ROMAN } from '@/types/rigveda'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  SpeakerIcon,
} from '@hugeicons/core-free-icons'

type Props = { params: Promise<{ bookId: string }> }

export async function generateStaticParams() {
  const books = await getAllBooks()
  return books.map((b) => ({ bookId: String(b.bookNum) }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bookId } = await params
  const book = await getBook(Number(bookId))
  if (!book) return {}
  const roman = ROMAN[book.bookNum] ?? book.bookNum
  return {
    title: `Mandala ${roman} — Book ${book.bookNum}`,
    description: `${book.hymns.length} hymns from ${book.title} of the Rig Veda.`,
  }
}

export default async function BookPage({ params }: Props) {
  const { bookId } = await params
  const bookNum = Number(bookId)
  const book = await getBook(bookNum)
  if (!book) notFound()

  const roman = ROMAN[book.bookNum] ?? String(book.bookNum)
  const hymnsWithAudio = book.hymns.filter((h) => h.audio_url).length

  // Adjacent book navigation
  const allBooks = await getAllBooks()
  const currentIdx = allBooks.findIndex((b) => b.bookNum === bookNum)
  const prevBook = currentIdx > 0 ? allBooks[currentIdx - 1] : null
  const nextBook = currentIdx < allBooks.length - 1 ? allBooks[currentIdx + 1] : null

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Library
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} color="currentColor" strokeWidth={2} />
          <span className="text-foreground font-medium">Book {book.bookNum}</span>
        </nav>

        {/* Header */}
        <div className="mb-10">
          <span className="mb-3 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Mandala {roman}
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {book.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {book.hymns.length} hymns
            {hymnsWithAudio > 0 && (
              <span className="ml-3 inline-flex items-center gap-1.5 text-sm">
                <HugeiconsIcon
                  icon={SpeakerIcon}
                  size={13}
                  color="currentColor"
                  strokeWidth={1.5}
                  className="text-primary"
                />
                {hymnsWithAudio} with audio
              </span>
            )}
          </p>
        </div>

        {/* Hymn list */}
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {book.hymns.map((hymn, idx) => {
            const hymnNum = idx + 1
            const hasAudio = !!hymn.audio_url
            return (
              <Link
                key={hymnNum}
                href={`/book/${bookNum}/hymn/${hymnNum}`}
                className="group flex items-center gap-4 bg-card px-5 py-3.5 transition-colors hover:bg-muted/60"
              >
                {/* Hymn number */}
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {String(hymnNum).padStart(3, '0')}
                </span>

                {/* Hymn title */}
                <span className="flex-1 text-sm text-card-foreground group-hover:text-foreground transition-colors leading-snug">
                  {hymn.title}
                </span>

                {/* Audio indicator */}
                {hasAudio && (
                  <HugeiconsIcon
                    icon={SpeakerIcon}
                    size={14}
                    color="currentColor"
                    strokeWidth={1.5}
                    className="shrink-0 text-primary opacity-70"
                  />
                )}

                {/* Arrow */}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  color="currentColor"
                  strokeWidth={1.5}
                  className="shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5"
                />
              </Link>
            )
          })}
        </div>

        {/* Book navigation */}
        <div className="mt-10 flex items-center justify-between gap-4">
          {prevBook ? (
            <Link
              href={`/book/${prevBook.bookNum}`}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
                className="transition-transform group-hover:-translate-x-0.5"
              />
              Book {prevBook.bookNum}
            </Link>
          ) : (
            <div />
          )}
          {nextBook ? (
            <Link
              href={`/book/${nextBook.bookNum}`}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              Book {nextBook.bookNum}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ) : (
            <div />
          )}
        </div>
      </main>
    </>
  )
}
