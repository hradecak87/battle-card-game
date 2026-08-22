'use client'
import { useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  description?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({ title, description, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-zinc-400">{description}</p>}
        </div>
        <span aria-hidden="true" className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  )
}
