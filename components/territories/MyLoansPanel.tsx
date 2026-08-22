'use client'

import { useEffect, useState } from 'react'
import { formatEta } from '@/lib/time/formatEta'
import { getMyLoans, recallLoan, type MyLoan } from '@/lib/territories/api'

export interface MyLoansPanelProps {
  myPlayerId: string | null
  refreshKey?: number
  onNavigateToTerritory?: (x: number, y: number) => void
  collapsible?: boolean
}

interface MyLoansExpandedContentProps {
  loans: MyLoan[] | null
  error: string | null
  recallingKey: string | null
  onRecall: (loan: MyLoan) => void
  onNavigateToTerritory?: (x: number, y: number) => void
}

function MyLoansExpandedContent({
  loans,
  error,
  recallingKey,
  onRecall,
  onNavigateToTerritory,
}: MyLoansExpandedContentProps) {
  if (error) {
    return <p className="text-sm text-red-400">{error}</p>
  }

  if (loans === null) {
    return <p className="text-sm text-zinc-400">Načítám…</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {loans.map((loan) => {
        const key = loan.card_instance_ids.join(',')
        const territoryLabel = loan.destination_territory_name
          ? `${loan.destination_territory_name} (${loan.destination_territory_x}, ${loan.destination_territory_y})`
          : `(${loan.destination_territory_x}, ${loan.destination_territory_y})`

        return (
          <li key={key} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-semibold">
                  {loan.borrower_display_name} ·{' '}
                  {onNavigateToTerritory ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToTerritory(loan.destination_territory_x, loan.destination_territory_y)}
                      className="underline hover:text-zinc-100"
                    >
                      {territoryLabel}
                    </button>
                  ) : (
                    territoryLabel
                  )}
                </p>
                <p className="text-zinc-400">{loan.card_names.join(', ')}</p>
                <p className="text-xs text-zinc-500">Konec půjčky: {formatEta(loan.loan_return_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => void onRecall(loan)}
                disabled={recallingKey === key}
                className="rounded border border-sky-600 px-3 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-900/30 disabled:opacity-50"
              >
                {recallingKey === key ? 'Odvolávám…' : 'Odvolat půjčku'}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function MyLoansPanel({
  myPlayerId,
  refreshKey,
  onNavigateToTerritory,
  collapsible = true,
}: MyLoansPanelProps) {
  const [loans, setLoans] = useState<MyLoan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recallingKey, setRecallingKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function load(cancelledRef?: { current: boolean }) {
    const { data, error: loadError } = await getMyLoans()
    if (cancelledRef?.current) return
    if (loadError) {
      setError(loadError.message)
      return
    }
    setError(null)
    setLoans(data ?? [])
  }

  useEffect(() => {
    if (!myPlayerId) return
    const cancelledRef = { current: false }
    void load(cancelledRef)
    const interval = setInterval(() => void load(cancelledRef), 15000)
    return () => {
      cancelledRef.current = true
      clearInterval(interval)
    }
  }, [myPlayerId, refreshKey])

  async function handleRecall(loan: MyLoan) {
    const key = loan.card_instance_ids.join(',')
    setRecallingKey(key)
    try {
      for (const cardInstanceId of loan.card_instance_ids) {
        const { error: recallError } = await recallLoan(cardInstanceId)
        if (recallError) {
          setError(recallError.message)
          return
        }
      }
      await load()
    } finally {
      setRecallingKey(null)
    }
  }

  if (!myPlayerId || (loans !== null && loans.length === 0 && !error)) {
    return null
  }

  const loanCountLabel = loans ? ` (${loans.length})` : ''

  if (collapsible && !expanded) {
    return (
      <div className="w-full rounded border border-zinc-800 p-4">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-bold text-zinc-300 hover:text-zinc-100"
        >
          <span>{`Moje půjčky${loanCountLabel}`}</span>
          <span aria-hidden="true">▾</span>
        </button>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        {loans === null ? <p className="mt-2 text-sm text-zinc-400">Načítám…</p> : null}
      </div>
    )
  }

  return (
    <div className="w-full rounded border border-zinc-800 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-300">Moje půjčky</h2>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-sm font-semibold text-zinc-400 hover:text-zinc-100"
            aria-label="Sbalit moje půjčky"
          >
            <span aria-hidden="true">▴</span>
          </button>
        ) : null}
      </div>
      <MyLoansExpandedContent
        loans={loans}
        error={error}
        recallingKey={recallingKey}
        onRecall={handleRecall}
        onNavigateToTerritory={onNavigateToTerritory}
      />
    </div>
  )
}
