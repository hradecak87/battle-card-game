'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/supabase/useSession'
import { supabase } from '@/lib/supabase/client'
import { PlayerProfileCard } from '@/components/players/PlayerProfileCard'
import { DailyRewardCard } from '@/components/players/DailyRewardCard'
import BattleHistoryList from '@/components/players/BattleHistoryList'

export default function ProfileMePage() {
  const router = useRouter()
  const { user, player, loading } = useSession()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    if (player && !player.onboarding_completed) {
      router.push('/onboarding/kingdom')
    }
  }, [loading, user, player, router])

  if (loading || !user || !player || !player.onboarding_completed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  async function handleUpdateKingdom(kingdomName: string, coatOfArmsId: string) {
    const { error } = await supabase.rpc('update_kingdom', {
      new_kingdom_name: kingdomName,
      new_coat_of_arms_id: coatOfArmsId,
    })
    return { error: error?.message ?? null }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <nav className="w-full max-w-xl flex justify-between items-center text-sm">
        <Link href="/" className="underline text-zinc-400 hover:text-zinc-200">
          ← Domů
        </Link>
        <div className="flex gap-4">
          <Link href="/leaderboard" className="underline text-zinc-400 hover:text-zinc-200">
            Žebříček
          </Link>
          <button type="button" onClick={handleLogout} className="underline text-zinc-400 hover:text-zinc-200">
            Odhlásit se
          </button>
        </div>
      </nav>
      <PlayerProfileCard player={player} editable onUpdateKingdom={handleUpdateKingdom} />
      <DailyRewardCard
        initialStreak={player.daily_reward_streak}
        initialLastClaimAt={player.last_daily_reward_at}
      />
      <BattleHistoryList playerId={player.id} />
    </main>
  )
}
