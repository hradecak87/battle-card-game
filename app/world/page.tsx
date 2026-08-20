'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AttacksInTransitList from '@/components/world/AttacksInTransitList'
import ActiveBattlesList from '@/components/world/ActiveBattlesList'
import ClaimsInProgressList from '@/components/world/ClaimsInProgressList'
import WorldEventsFeed from '@/components/world/WorldEventsFeed'
import { useSession } from '@/lib/supabase/useSession'
import {
  listActiveBattles,
  listAttacksInTransit,
  listClaimsInProgress,
  listWorldEvents,
  type ActiveBattleRow,
  type AttackInTransitRow,
  type ClaimInProgressRow,
  type WorldEventRow,
} from '@/lib/world/api'

const FEED_PAGE_SIZE = 10

export default function WorldPage() {
  const router = useRouter()
  const { user, loading } = useSession()
  const [attacks, setAttacks] = useState<AttackInTransitRow[]>([])
  const [claims, setClaims] = useState<ClaimInProgressRow[]>([])
  const [battles, setBattles] = useState<ActiveBattleRow[]>([])
  const [events, setEvents] = useState<WorldEventRow[]>([])
  const [eventsTotalCount, setEventsTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
    }
  }, [loading, router, user])

  useEffect(() => {
    if (!user) return

    let cancelled = false
    async function loadLiveSections() {
      const [attacksResult, claimsResult, battlesResult] = await Promise.all([
        listAttacksInTransit(),
        listClaimsInProgress(),
        listActiveBattles(),
      ])
      if (cancelled) return

      const error = attacksResult.error ?? claimsResult.error ?? battlesResult.error
      if (error) {
        setLiveError(error.message)
        return
      }

      setLiveError(null)
      setAttacks(attacksResult.data ?? [])
      setClaims(claimsResult.data ?? [])
      setBattles(battlesResult.data ?? [])
    }

    void loadLiveSections()
    const intervalId = window.setInterval(loadLiveSections, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [user])

  useEffect(() => {
    if (!user) return

    let cancelled = false
    async function loadFeed() {
      const { data, error } = await listWorldEvents(page, FEED_PAGE_SIZE)
      if (cancelled) return
      if (error) {
        setFeedError(error.message)
        return
      }

      setFeedError(null)
      setEvents(data ?? [])
      setEventsTotalCount(data?.[0]?.total_count ?? 0)
    }

    void loadFeed()
    return () => {
      cancelled = true
    }
  }, [page, user])

  if (loading || !user) {
    return (
      <main className="min-h-screen p-6 sm:p-10">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm text-zinc-400">Načítám…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-zinc-100">Dění ve světě</h1>
          <p className="text-sm text-zinc-400">
            Veřejný přehled útoků, záborů, bitev a čerstvých událostí z celého království.
          </p>
        </div>

        {liveError && <p className="text-sm text-red-400">{liveError}</p>}
        {feedError && <p className="text-sm text-red-400">{feedError}</p>}

        <AttacksInTransitList attacks={attacks} />
        <ClaimsInProgressList claims={claims} />
        <ActiveBattlesList battles={battles} />
        <WorldEventsFeed
          events={events}
          page={page}
          pageSize={FEED_PAGE_SIZE}
          totalCount={eventsTotalCount}
          onPageChange={setPage}
        />
      </div>
    </main>
  )
}
