'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Fuse from 'fuse.js'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { ROMAN } from '@/types/rigveda'

// ── Search index entry ────────────────────────────────────────────────────────
type IndexEntry = {
  bookNum: number
  hymnIndex: number
  title: string
  deity: string // extracted from title, e.g. "Agni" from "HYMN I. Agni."
  href: string
  label: string // "Mandala I · Book 1"
}

// Module-level cache — built once per browser session, survives re-renders
let cachedIndex: Fuse<IndexEntry> | null = null
let cachedEntries: IndexEntry[] | null = null

const CDN_BASE =
  process.env.NEXT_PUBLIC_CDN_BASE ?? 'https://ankurs-books-assets.t3.tigrisfiles.io'

const SOURCE_FILES = [
  'rigveda_modern-1-2.json',
  'rigveda_modern-3-4.json',
  'rigveda_modern-5-6.json',
  'rigveda_modern-7-8.json',
  'rigveda_modern-9-10.json',
]

function extractDeity(title: string): string {
  // "HYMN I. Agni." → "Agni"
  // "HYMN XXXVIII. Savitar." → "Savitar"
  const m = title.match(/HYMN\s+[IVXLCDM]+\.?\s+(.+?)\.?\s*$/)
  return m ? m[1].trim() : ''
}

async function buildIndex(): Promise<{ index: Fuse<IndexEntry>; entries: IndexEntry[] }> {
  if (cachedIndex && cachedEntries) {
    return { index: cachedIndex, entries: cachedEntries }
  }

  const results = await Promise.all(
    SOURCE_FILES.map((f) =>
      fetch(`${CDN_BASE}/data/${f}`).then((r) => r.json()),
    ),
  )

  const entries: IndexEntry[] = []
  for (const file of results) {
    for (const book of file.books) {
      const m = book.title.match(/Book\s+(\d+)/)
      const bookNum = m ? parseInt(m[1], 10) : 0
      const roman = ROMAN[bookNum] ?? String(bookNum)
      const label = `Mandala ${roman} · Book ${bookNum}`

      for (let i = 0; i < book.hymns.length; i++) {
        const hymn = book.hymns[i]
        const hymnIndex = i + 1
        entries.push({
          bookNum,
          hymnIndex,
          title: hymn.title,
          deity: extractDeity(hymn.title),
          href: `/book/${bookNum}/hymn/${hymnIndex}`,
          label,
        })
      }
    }
  }

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'deity', weight: 2 },
      { name: 'title', weight: 1 },
    ],
    threshold: 0.35,
    distance: 80,
    minMatchCharLength: 2,
    includeScore: true,
  })

  cachedIndex = fuse
  cachedEntries = entries
  return { index: fuse, entries }
}

// ── Global event bus for opening the modal ────────────────────────────────────
// Avoids prop-drilling through the layout. Components dispatch a custom event;
// SearchModal listens for it.
const OPEN_EVENT = 'search:open'
export function openSearch() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

// ── SearchModal ───────────────────────────────────────────────────────────────
export function SearchModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IndexEntry[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const fuseRef = useRef<Fuse<IndexEntry> | null>(null)

  // Open on Cmd+K / Ctrl+K and custom event
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onCustomEvent() { setOpen(true) }

    window.addEventListener('keydown', onKeydown)
    window.addEventListener(OPEN_EVENT, onCustomEvent)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener(OPEN_EVENT, onCustomEvent)
    }
  }, [])

  // When modal opens: focus input, load index lazily
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    if (!fuseRef.current) {
      setLoading(true)
      buildIndex().then(({ index }) => {
        fuseRef.current = index
        setLoading(false)
      })
    }
  }, [open])

  // Run search on query change
  useEffect(() => {
    if (!fuseRef.current || !query.trim()) {
      setResults([])
      setSelected(0)
      return
    }
    const hits = fuseRef.current.search(query, { limit: 10 })
    setResults(hits.map((h) => h.item))
    setSelected(0)
  }, [query])

  // Keyboard navigation inside the list
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter' && results[selected]) {
        navigate(results[selected].href)
      }
    },
    [results, selected],
  )

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function navigate(href: string) {
    setOpen(false)
    setQuery('')
    setResults([])
    router.push(href)
  }

  function close() {
    setOpen(false)
    setQuery('')
    setResults([])
  }

  if (!open) return null

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      onClick={close}
    >
      {/* Dim overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal panel */}
      <div
        className={cn(
          'relative z-10 w-full max-w-xl overflow-hidden',
          'rounded-2xl border border-border bg-card shadow-2xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            color="currentColor"
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search hymns by deity or title…"
            className={cn(
              'flex-1 bg-transparent text-sm text-foreground outline-none',
              'placeholder:text-muted-foreground',
            )}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline-block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        {loading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading index…
          </p>
        )}

        {!loading && query && results.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hymns found for &ldquo;{query}&rdquo;
          </p>
        )}

        {!loading && !query && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Type a deity name or hymn title
          </p>
        )}

        {results.length > 0 && (
          <ul ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
            {results.map((entry, i) => (
              <li key={entry.href}>
                <button
                  type="button"
                  onClick={() => navigate(entry.href)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    i === selected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-card-foreground hover:bg-muted',
                  )}
                  onMouseEnter={() => setSelected(i)}
                >
                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.title}</p>
                    <p className="text-xs text-muted-foreground">{entry.label}</p>
                  </div>

                  {/* Arrow */}
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={13}
                    color="currentColor"
                    strokeWidth={1.5}
                    className={cn(
                      'shrink-0 transition-opacity',
                      i === selected ? 'opacity-70' : 'opacity-0',
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}
