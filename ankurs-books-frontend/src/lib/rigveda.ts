import type { Book, RigvedaFile } from '@/types/rigveda'

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE ?? 'https://ankurs-books-assets.t3.tigrisfiles.io'

const SOURCE_FILES = [
  'rigveda_modern-1-2.json',
  'rigveda_modern-3-4.json',
  'rigveda_modern-5-6.json',
  'rigveda_modern-7-8.json',
  'rigveda_modern-9-10.json',
]

function extractBookNum(title: string): number {
  const m = title.match(/Book\s+(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Fetch all 5 JSON files from CDN and flatten into 10 Book objects. */
export async function getAllBooks(): Promise<Book[]> {
  const results = await Promise.all(
    SOURCE_FILES.map((filename) =>
      fetch(`${CDN_BASE}/data/${filename}`, {
        next: { revalidate: 86400 },
      }).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${filename}: ${r.status}`)
        return r.json() as Promise<RigvedaFile>
      })
    )
  )

  const books: Book[] = []
  for (const file of results) {
    for (const b of file.books) {
      books.push({
        title: b.title,
        url: b.url,
        hymns: b.hymns,
        bookNum: extractBookNum(b.title),
      })
    }
  }

  return books.sort((a, b) => a.bookNum - b.bookNum)
}

/** Fetch a single book by its number (1–10). */
export async function getBook(bookNum: number): Promise<Book | null> {
  const books = await getAllBooks()
  return books.find((b) => b.bookNum === bookNum) ?? null
}

/** Fetch a single hymn by book number and 1-based hymn index. */
export async function getHymn(bookNum: number, hymnIndex: number) {
  const book = await getBook(bookNum)
  if (!book) return null
  const hymn = book.hymns[hymnIndex - 1]
  if (!hymn) return null
  return { hymn, book }
}

/** All [bookId, hymnId] pairs for generateStaticParams. */
export async function getAllHymnParams() {
  const books = await getAllBooks()
  const params: { bookId: string; hymnId: string }[] = []
  for (const book of books) {
    for (let i = 1; i <= book.hymns.length; i++) {
      params.push({ bookId: String(book.bookNum), hymnId: String(i) })
    }
  }
  return params
}
