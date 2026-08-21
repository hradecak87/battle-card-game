'use client'

import { useEffect, useRef, useState } from 'react'
import { searchPlayers, type PlayerSearchResult } from '@/lib/players/api'

export interface PlayerSearchSelection {
  id: string
  label: string
}

export interface PlayerSearchInputProps {
  value: PlayerSearchSelection | null
  onChange: (selection: PlayerSearchSelection | null) => void
  placeholder?: string
  disabled?: boolean
}

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

function formatOption(result: PlayerSearchResult) {
  return result.kingdom_name ? `${result.display_name} (${result.kingdom_name})` : result.display_name
}

export function PlayerSearchInput({ value, onChange, placeholder, disabled }: PlayerSearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([])
      setIsOpen(false)
      return
    }

    const requestId = ++requestIdRef.current
    const timeoutId = window.setTimeout(async () => {
      const { data, error: searchError } = await searchPlayers(query.trim())
      if (requestId !== requestIdRef.current) return

      if (searchError) {
        setError(searchError.message)
        setResults([])
        setIsOpen(false)
        return
      }

      setError(null)
      setResults(data ?? [])
      setIsOpen(true)
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [query])

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
        <span className="flex-1">{value.label}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Zrušit výběr hráče"
          className="text-zinc-400 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true)
        }}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        placeholder={placeholder ?? 'Hledej hráče (jméno, království, e-mail)…'}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({ id: result.id, label: formatOption(result) })
                  setQuery('')
                  setResults([])
                  setIsOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${result.is_online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                  aria-hidden
                />
                <span>{formatOption(result)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isOpen && results.length === 0 && !error && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 shadow-lg">
          Žádný hráč nenalezen.
        </div>
      )}
    </div>
  )
}
