'use client'

import { useEffect, useState } from 'react'
import { getTemplateById } from '@/lib/cards/catalog'
import type { Rank } from '@/lib/cards/types'
import { claimDailyReward, type DailyRewardGrant } from '@/lib/players/api'

const FRIENDLY_ALREADY_CLAIMED_MESSAGE = 'Dnešní odměna už byla vyzvednuta. Přijď zítra znovu.'
const GENERIC_ERROR_MESSAGE = 'Denní odměnu se nepodařilo vyzvednout. Zkus to prosím znovu.'
const RANK_LABELS: Record<Rank, string> = {
  common: 'běžná',
  uncommon: 'neobvyklá',
  rare: 'vzácná',
  epic: 'epická',
  legend: 'legendární',
}

export interface DailyRewardCardProps {
  initialStreak: number
  initialLastClaimAt: string | null
}

function utcDayKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

function currentUtcDayKey() {
  return utcDayKey(new Date())
}

function hasClaimedToday(lastClaimAt: string | null) {
  if (!lastClaimAt) return false
  return utcDayKey(lastClaimAt) === currentUtcDayKey()
}

function streakLabel(streak: number) {
  if (streak === 1) return '1 den'
  return `${streak} dní`
}

function rewardName(templateId: string) {
  return getTemplateById(templateId)?.name ?? templateId
}

function RewardList({ grantedCards }: { grantedCards: DailyRewardGrant[] }) {
  return (
    <ul className="mt-3 space-y-1 text-sm text-emerald-200">
      {grantedCards.map((card) => (
        <li key={`${card.template_id}-${card.rank}`}>
          {rewardName(card.template_id)} <span className="text-zinc-400">({RANK_LABELS[card.rank]})</span>
        </li>
      ))}
    </ul>
  )
}

export function DailyRewardCard({ initialStreak, initialLastClaimAt }: DailyRewardCardProps) {
  const [streak, setStreak] = useState(initialStreak)
  const [lastClaimAt, setLastClaimAt] = useState(initialLastClaimAt)
  const [todayKey, setTodayKey] = useState(currentUtcDayKey)
  const [grantedCards, setGrantedCards] = useState<DailyRewardGrant[]>([])
  const [status, setStatus] = useState<'idle' | 'success' | 'already-claimed' | 'error'>(
    hasClaimedToday(initialLastClaimAt) ? 'already-claimed' : 'idle'
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTodayKey(currentUtcDayKey())
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  const claimedToday = lastClaimAt ? utcDayKey(lastClaimAt) === todayKey : false

  async function handleClaim() {
    if (claimedToday || submitting) return

    setSubmitting(true)
    setStatus('idle')

    const { data, error } = await claimDailyReward()

    setSubmitting(false)

    if (error) {
      if (error.message === 'daily reward already claimed today') {
        setLastClaimAt(new Date().toISOString())
        setStatus('already-claimed')
        return
      }
      setStatus('error')
      return
    }

    if (!data) {
      setStatus('error')
      return
    }

    setStreak(data.streak)
    setLastClaimAt(data.claimed_at)
    setGrantedCards(data.granted_cards)
    setStatus('success')
  }

  return (
    <section className="w-full max-w-xl rounded-lg border border-zinc-800 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Denní odměna</h2>
          <p className="text-sm text-zinc-400">Aktuální série: {streakLabel(streak)}</p>
        </div>
        <button
          type="button"
          onClick={handleClaim}
          disabled={claimedToday || submitting}
          className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Vyzvedávám…' : claimedToday ? 'Vyzvednuto dnes' : 'Vyzvednout denní odměnu'}
        </button>
      </div>

      <p className="mt-3 text-sm text-zinc-400">
        Každý den získáš 1 náhodnou common jednotku. Každý 7. claim v řadě navíc přidá 1 uncommon jednotku.
      </p>

      {claimedToday && status !== 'success' && (
        <p className="mt-3 text-sm text-amber-300">{FRIENDLY_ALREADY_CLAIMED_MESSAGE}</p>
      )}
      {status == 'error' && <p className="mt-3 text-sm text-red-400">{GENERIC_ERROR_MESSAGE}</p>}
      {status == 'success' && (
        <div>
          <p className="mt-3 text-sm text-emerald-300">Denní odměna byla úspěšně vyzvednuta.</p>
          <RewardList grantedCards={grantedCards} />
        </div>
      )}
    </section>
  )
}
