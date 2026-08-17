'use client'

import type { MouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { EffectiveCard, UnitCardTemplate } from '@/lib/cards/types'
import { TradingCard } from './TradingCard'

export interface ZoomedCardState {
  template: UnitCardTemplate
  stats: EffectiveCard
}

interface CardZoomModalProps {
  template: UnitCardTemplate
  stats: EffectiveCard
  onClose: () => void
}

interface CardZoomOverlayProps {
  card: ZoomedCardState | null
  onClose: () => void
}

interface CardZoomIconButtonProps {
  cardName: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  className?: string
}

export function useCardZoom() {
  const [zoomedCard, setZoomedCard] = useState<ZoomedCardState | null>(null)

  return {
    zoomedCard,
    openZoom(template: UnitCardTemplate, stats: EffectiveCard) {
      setZoomedCard({ template, stats })
    },
    closeZoom() {
      setZoomedCard(null)
    },
  }
}

export function CardZoomIconButton({ cardName, onClick, className = '' }: CardZoomIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Zvětšit kartu ${cardName}`}
      title="Zvětšit kartu"
      onClick={onClick}
      className={`rounded-full border border-zinc-600 bg-black/70 px-2 py-1 text-xs text-white shadow-sm transition hover:bg-black/85 ${className}`}
    >
      🔍
    </button>
  )
}

export function CardZoomModal({ template, stats, onClose }: CardZoomModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    closeButtonRef.current?.focus()
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div
      data-testid="card-zoom-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        data-testid="card-zoom-backdrop"
        className="absolute inset-0"
      />
      <div
        data-testid="card-zoom-content"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detail karty ${template.name}`}
        className="relative z-10"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          ref={closeButtonRef}
          aria-label="Zavřít detail karty"
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 rounded-full border border-zinc-500 bg-zinc-950 px-3 py-1 text-lg text-zinc-100 shadow-lg transition hover:bg-zinc-800"
        >
          ✕
        </button>
        <div className="w-[min(88vw,380px)]">
          <TradingCard template={template} stats={stats} />
        </div>
      </div>
    </div>
  )
}

export function CardZoomOverlay({ card, onClose }: CardZoomOverlayProps) {
  if (!card) return null

  return <CardZoomModal template={card.template} stats={card.stats} onClose={onClose} />
}
