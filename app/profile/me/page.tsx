'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/supabase/useSession'
import { supabase } from '@/lib/supabase/client'
import { PlayerProfileCard } from '@/components/players/PlayerProfileCard'

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

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <PlayerProfileCard player={player} editable onUpdateKingdom={handleUpdateKingdom} />
    </main>
  )
}
