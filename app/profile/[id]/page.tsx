'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { PlayerProfileCard } from '@/components/players/PlayerProfileCard'
import type { PlayerRow } from '@/lib/supabase/useSession'

export default function ProfilePage({ params }: { params: { id: string } }) {
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('players')
      .select('*')
      .eq('id', params.id)
      .single()
      .then(({ data, error }: { data: PlayerRow | null; error: unknown }) => {
        if (cancelled) return
        if (error || !data) {
          setNotFound(true)
        } else {
          setPlayer(data)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params.id])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  if (notFound || !player) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Hráč nebyl nalezen.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <div className="w-full max-w-xl">
        <Link href="/" className="underline text-sm text-zinc-400 hover:text-zinc-200">
          ← Domů
        </Link>
      </div>
      <PlayerProfileCard player={player} />
    </main>
  )
}
