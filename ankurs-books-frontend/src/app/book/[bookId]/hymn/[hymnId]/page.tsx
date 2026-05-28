import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { AudioPlayer } from '@/components/AudioPlayer'
import { getAllHymnParams, getBook, getHymn } from '@/lib/rigveda'
import { ROMAN } from '@/types/rigveda'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'

type Props = { params: Promise<{ bookId: string; hymnId: string }> }

export async function generateStaticParams() {
  return getAllHymnParams()
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bookId, hymnId } = await params
  const result = await getHymn(Number(bookId), Number(hymnId))
  if (!result) return {}
  const { hymn, book } = result
  const roman = ROMAN[book.bookNum] ?? book.bookNum
  return {
    title: `${hymn.title} — Mandala ${roman}`,
    description: hymn.content.slice(0, 160).replace(/\n/g, ' '),
  }
}

/** Parse hymn content into structured verses.
 *  Lines starting with a number (possibly followed by a period) are verse markers.
 *  Returns array of { num, lines[] }
 */
function parseVerses(content: string): { num: string; text: string }[] {
  const lines = content.split('\n')
  const verses: { num: string; text: string }[] = []
  let current: { num: string; lines: string[] } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Match leading verse number: "1 ", "12 ", "1. ", "12. "
    const numMatch = line.match(/^(\d{1,3})\.?\s+(.*)/)
    if (numMatch) {
      if (current) verses.push({ num: current.num, text: current.lines.join(' ') })
      current = { num: numMatch[1], lines: [numMatch[2].trim()] }
    } else if (current) {
      current.lines.push(line)
    } else {
      // Content before first numbered verse
      verses.push({ num: '', text: line })
    }
  }
  if (current) verses.push({ num: current.num, text: current.lines.join(' ') })
  return verses
}

export default async function HymnPage({ params }: Props) {
  const { bookId, hymnId } = await params
  const bookNum = Number(bookId)
  const hymnNum = Number(hymnId)

  const result = await getHymn(bookNum, hymnNum)
  if (!result) notFound()

  const { hymn, book } = result
  const roman = ROMAN[book.bookNum] ?? String(book.bookNum)
  const verses = parseVerses(hymn.content)

  // Adjacent hymn navigation — cross book boundaries correctly
  const prevHymn = hymnNum > 1 ? hymnNum - 1 : null
  const nextHymn = hymnNum < book.hymns.length ? hymnNum + 1 : null

  // Fetch adjacent books only when needed (build-time, cached)
  const [prevBookData, nextBookData] = await Promise.all([
    hymnNum === 1 && bookNum > 1 ? getBook(bookNum - 1) : Promise.resolve(null),
    hymnNum === book.hymns.length && bookNum < 10 ? getBook(bookNum + 1) : Promise.resolve(null),
  ])

  let prevLink: string | null = null
  let nextLink: string | null = null
  let prevLabel: string | null = null
  let nextLabel: string | null = null

  if (prevHymn) {
    prevLink = `/book/${bookNum}/hymn/${prevHymn}`
    prevLabel = `Hymn ${prevHymn}`
  } else if (prevBookData) {
    // Link directly to the last hymn of the previous book
    const lastHymn = prevBookData.hymns.length
    prevLink = `/book/${prevBookData.bookNum}/hymn/${lastHymn}`
    prevLabel = `Book ${prevBookData.bookNum}, Hymn ${lastHymn}`
  }

  if (nextHymn) {
    nextLink = `/book/${bookNum}/hymn/${nextHymn}`
    nextLabel = `Hymn ${nextHymn}`
  } else if (nextBookData) {
    nextLink = `/book/${nextBookData.bookNum}/hymn/1`
    nextLabel = `Book ${nextBookData.bookNum}, Hymn 1`
  }

  const hymnKey = `book-${bookNum}-hymn-${hymnNum}`

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="mb-8 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Link href="/" className="hover:text-foreground transition-colors">
            Library
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} color="currentColor" strokeWidth={2} />
          <Link
            href={`/book/${bookNum}`}
            className="hover:text-foreground transition-colors"
          >
            Book {bookNum}
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} color="currentColor" strokeWidth={2} />
          <span className="text-foreground font-medium">
            Hymn {String(hymnNum).padStart(3, '0')}
          </span>
        </nav>

        {/* Hymn header */}
        <div className="mb-6">
          <span className="mb-2 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            Mandala {roman}
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl leading-snug">
            {hymn.title}
          </h1>
        </div>

        {/* Audio player */}
        {hymn.audio_url && (
          <div className="mb-8">
            <AudioPlayer audioUrl={hymn.audio_url} hymnKey={hymnKey} />
          </div>
        )}

        {/* Hymn content */}
        <article className="space-y-5">
          {verses.map((verse, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: verses have no stable id
            <div key={i} className="group flex gap-4">
              {verse.num && (
                <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-primary/60 tabular-nums select-none">
                  {verse.num}
                </span>
              )}
              <p
                className={
                  verse.num
                    ? 'flex-1 text-base leading-relaxed text-foreground'
                    : 'flex-1 text-base leading-relaxed text-foreground'
                }
              >
                {verse.text}
              </p>
            </div>
          ))}
        </article>

        {/* Source attribution */}
        <div className="mt-10 border-t border-border pt-5">
          <a
            href={hymn.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Source: Sacred Texts Archive
          </a>
        </div>

        {/* Prev / Next navigation */}
        <div className="mt-8 flex items-center justify-between gap-4">
          {prevLink && prevLabel ? (
            <Link
              href={prevLink}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
                className="transition-transform group-hover:-translate-x-0.5"
              />
              {prevLabel}
            </Link>
          ) : (
            <div />
          )}
          {nextLink && nextLabel ? (
            <Link
              href={nextLink}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              {nextLabel}
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
