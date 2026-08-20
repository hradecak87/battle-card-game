'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { isValidMessageBody } from '@/lib/chat/validation'

const COOLDOWN_MS = 2000

export interface MessageInputProps {
  onSend: (body: string) => Promise<void> | void
  disabled?: boolean
  sending?: boolean
  error?: string | null
  lastSentAt?: number | null
  placeholder?: string
}

export function MessageInput({
  onSend,
  disabled = false,
  sending = false,
  error = null,
  lastSentAt = null,
  placeholder = 'Napiš zprávu…',
}: MessageInputProps) {
  const [body, setBody] = useState('')
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    const updateRemaining = () => {
      if (lastSentAt === null) {
        setRemainingMs(0)
        return
      }
      setRemainingMs(Math.max(0, lastSentAt + COOLDOWN_MS - Date.now()))
    }

    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, 100)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [lastSentAt])

  const isCoolingDown = remainingMs > 0
  const isValid = useMemo(() => isValidMessageBody(body), [body])
  const canSend = !disabled && !sending && !isCoolingDown && isValid

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return

    const trimmed = body.trim()
    await onSend(trimmed)
    setBody('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2" data-testid="message-input">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={500}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-amber-500"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-zinc-400">
          <span data-testid="message-char-count">{body.length}/500</span>
          {isCoolingDown && <span className="ml-2 text-amber-300">Počkej {Math.ceil(remainingMs / 1000)} s</span>}
          {!isValid && body.trim().length > 0 && <span className="ml-2 text-red-400">Maximálně 500 znaků.</span>}
          {error && <span className="ml-2 text-red-400">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-full border border-amber-600 px-4 py-1.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Odesílám…' : 'Odeslat'}
        </button>
      </div>
    </form>
  )
}
