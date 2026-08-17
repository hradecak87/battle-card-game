'use client'

import Link from 'next/link'
import { useSession } from '@/lib/supabase/useSession'

/**
 * Small always-visible strip mounted once in the root layout so it's
 * never possible to be silently logged out without noticing (a real bug
 * hit during playtesting: a session got invalidated — most likely from
 * testing two accounts in the same browser, since Supabase persists the
 * auth session in localStorage shared across all tabs of one origin —
 * and nothing on-screen indicated it). Shows the logged-in email so it
 * also makes it obvious which account a given tab is actually using.
 */
export function AuthStatusBar() {
  const { user, loading } = useSession()

  if (loading) return null

  if (!user) {
    return (
      <div className="bg-amber-900/60 px-4 py-1 text-center text-xs text-amber-200">
        Nejsi přihlášen/a.{' '}
        <Link href="/login" className="underline hover:text-amber-100">
          Přihlásit se
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 px-4 py-1 text-center text-xs text-zinc-500">
      Přihlášen/a jako {user.email}
    </div>
  )
}
