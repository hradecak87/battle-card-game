'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/supabase/useSession'
import { listMyOffers } from '@/lib/trading/api'
import { getAdminStatus } from '@/lib/admin/api'

export function MainNav() {
  const { user, player, loading } = useSession()
  const [pendingCount, setPendingCount] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)

  const links = useMemo(() => {
    if (!user) {
      return [
        { href: '/', label: 'Domů' },
        { href: '/login', label: 'Přihlásit se' },
        { href: '/leaderboard', label: 'Žebříček' },
      ]
    }

    const baseLinks = [
      { href: '/', label: 'Domů' },
      { href: '/map', label: 'Mapa' },
      { href: '/collection', label: 'Moje sbírka' },
      { href: '/exchange', label: 'Směnárna', badge: pendingCount },
      { href: '/leaderboard', label: 'Žebříček' },
      { href: '/profile/me', label: 'Můj profil' },
    ]
    return isAdmin ? [...baseLinks, { href: '/admin', label: '🛠️ Admin' }] : baseLinks
  }, [isAdmin, pendingCount, user])

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    getAdminStatus(user.id).then(({ data, error }) => {
      if (cancelled || error) return
      setIsAdmin(Boolean(data?.is_admin))
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) {
      setPendingCount(0)
      return
    }

    let cancelled = false
    const userId = user.id
    async function loadCount() {
      const { data, error } = await listMyOffers()
      if (cancelled || error) return
      setPendingCount(
        (data ?? []).filter(
          (offer) =>
            offer.type === 'direct' &&
            offer.status === 'pending' &&
            offer.target_player_id === userId
        ).length
      )
    }

    loadCount()
    const intervalId = window.setInterval(loadCount, 15000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [user])

  if (loading) return null

  return (
    <nav className="border-b border-zinc-900 bg-zinc-950/95 px-4 py-3">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 text-sm">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1.5 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
          >
            <span>{link.label}</span>
            {link.badge != null && link.badge > 0 && (
              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white">
                {link.badge}
              </span>
            )}
          </Link>
        ))}
        {user && player && !player.onboarding_completed && (
          <span className="text-xs text-amber-300">Dokonči onboarding království.</span>
        )}
      </div>
    </nav>
  )
}
