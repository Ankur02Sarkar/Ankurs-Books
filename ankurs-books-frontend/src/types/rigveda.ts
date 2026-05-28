export type Hymn = {
  title: string
  url: string
  content: string
  audio_url?: string
}

export type Book = {
  title: string
  url: string
  hymns: Hymn[]
  bookNum: number
}

export type RigvedaFile = {
  book_title: string
  index_url: string
  books: Array<{
    title: string
    url: string
    hymns: Hymn[]
  }>
}

/** Roman numeral map for display labels (Mandala I – X) */
export const ROMAN: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V',
  6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
}
