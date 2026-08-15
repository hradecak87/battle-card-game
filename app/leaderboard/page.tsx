'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { NATIONS, type NationId } from '@/lib/players/nations'
import { levelForXp } from '@/lib/players/leveling'

interface LeaderboardRow {
  id: string
  display_name: string
  nation: NationId
  xp: number
  kingdom_name: string | null
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LeaderboardRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('players')
      .select('*')
      .eq('onboarding_completed', true)
      .then(({ data }: { data: LeaderboardRow[] | null }) => {
        if (cancelled) return
        const sorted = [...(data ?? [])].sort((a, b) => {
          const levelDiff = levelForXp(b.xp) - levelForXp(a.xp)
          return levelDiff !== 0 ? levelDiff : b.xp - a.xp
        })
        setPlayers(sorted)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl">
        <Link href="/" className="underline text-sm text-zinc-400 hover:text-zinc-200">
          ← Domů
        </Link>
        <h1 className="text-2xl font-bold mb-6 text-center">Žebříček</h1>
        {players === null ? (
          <p className="text-zinc-400 text-center">Načítám…</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {players.map((p, i) => {
              const nation = NATIONS.find((n) => n.id === p.nation)
              return (
                <li
                  key={p.id}
                  data-testid="leaderboard-row"
                  className="flex items-center gap-4 rounded border border-zinc-800 px-4 py-2"
                >
                  <span className="w-8 text-right font-bold text-zinc-400">{i + 1}</span>
                  <Link href={`/profile/${p.id}`} className="flex-1 hover:underline">
                    {p.display_name}
                    <span className="text-zinc-500 text-sm ml-2">{p.kingdom_name}</span>
                  </Link>
                  <span className="text-sm text-zinc-400">{nation?.name}</span>
                  <span className="font-semibold">Lv. {levelForXp(p.xp)}</span>
                  <span className="text-sm text-zinc-500">{p.xp} XP</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </main>
  )
}
