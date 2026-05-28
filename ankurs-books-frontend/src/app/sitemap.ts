import type { MetadataRoute } from 'next'
import { getAllBooks } from '@/lib/rigveda'

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  'http://localhost:3000'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const books = await getAllBooks()
  const now = new Date()

  const entries: MetadataRoute.Sitemap = [
    // Home
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 1.0,
    },
  ]

  // Book index pages
  for (const book of books) {
    entries.push({
      url: `${SITE_URL}/book/${book.bookNum}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    })

    // Individual hymn pages
    for (let i = 1; i <= book.hymns.length; i++) {
      entries.push({
        url: `${SITE_URL}/book/${book.bookNum}/hymn/${i}`,
        lastModified: now,
        changeFrequency: 'yearly',
        priority: 0.6,
      })
    }
  }

  return entries
}
