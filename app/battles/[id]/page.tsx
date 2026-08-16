'use client'

import Link from 'next/link'
import { useSession } from '@/lib/supabase/useSession'
import BattleScreen from '@/components/battles/BattleScreen'

export default function BattlePage({ params }: { params: { id: string } }) {
  const { user } = useSession()

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <Link href="/map" className="underline text-sm text-zinc-400 hover:text-zinc-200">
        ← Zpět na mapu
      </Link>
      <h1 className="text-2xl font-bold mb-4 mt-2 text-center">Bitva</h1>
      <BattleScreen battleId={params.id} currentUserId={user?.id ?? null} />
    </main>
  )
}
