'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Moon01Icon, Sun01Icon, BookOpen01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { SearchModal, openSearch } from '@/components/SearchModal'

export function SiteHeader() {
  const [isDark, setIsDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Logo / site name */}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-foreground transition-opacity hover:opacity-70"
          >
            <HugeiconsIcon
              icon={BookOpen01Icon}
              size={20}
              color="currentColor"
              strokeWidth={1.5}
              className="text-primary"
            />
            <span className="text-sm font-semibold tracking-wide">Ankur's Books</span>
          </Link>

          {/* Right side controls */}
          <div className="flex items-center gap-1.5">
            {/* Search trigger — pill on desktop, icon on mobile */}
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search hymns"
              className={cn(
                'flex items-center gap-2 rounded-full text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // Desktop: pill with ⌘K hint
                'sm:border sm:border-border sm:bg-muted/40 sm:px-3 sm:py-1.5',
                // Mobile: bare icon button
                'size-8 justify-center sm:size-auto sm:justify-start',
              )}
            >
              <HugeiconsIcon
                icon={Search01Icon}
                size={15}
                color="currentColor"
                strokeWidth={1.5}
              />
              <span className="hidden text-xs sm:inline">Search</span>
              <kbd className="hidden rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 sm:inline-block">
                ⌘K
              </kbd>
            </button>

            {/* Dark mode toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className={cn(
                'flex size-8 items-center justify-center rounded-full',
                'text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {mounted ? (
                <HugeiconsIcon
                  icon={isDark ? Sun01Icon : Moon01Icon}
                  size={16}
                  color="currentColor"
                  strokeWidth={1.5}
                />
              ) : (
                <span className="size-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Search modal — rendered outside header flow, portal-like via fixed positioning */}
      <SearchModal />
    </>
  )
}
