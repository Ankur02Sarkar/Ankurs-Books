'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Moon01Icon, Sun01Icon, BookOpen01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

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
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo / site name */}
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-70"
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
          {/* Render a placeholder until mounted to avoid hydration mismatch */}
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
    </header>
  )
}
