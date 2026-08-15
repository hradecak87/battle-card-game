'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

/**
 * Two modes on one route (design spec §7):
 * - No recovery session yet: collect an email, ask Supabase to send the
 *   reset link (which redirects back here with a recovery session set).
 * - Arrived via that emailed link (Supabase sets a recovery session):
 *   collect + submit a new password.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [hasRecoverySession, setHasRecoverySession] = useState(false)
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setHasRecoverySession(true)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    setSubmitting(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setMessage('Pokud účet s tímto e-mailem existuje, poslali jsme odkaz na obnovení hesla.')
  }

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    router.push('/login')
  }

  if (hasRecoverySession) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <form onSubmit={handleSetNewPassword} className="w-full max-w-sm flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-center mb-2">Nastavit nové heslo</h1>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">Nové heslo</span>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            />
          </label>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors disabled:opacity-50"
          >
            {submitting ? 'Ukládám…' : 'Uložit heslo'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleRequestReset} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center mb-2">Obnovit heslo</h1>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">E-mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </label>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {message && <p className="text-emerald-400 text-sm">{message}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors disabled:opacity-50"
        >
          {submitting ? 'Odesílám…' : 'Poslat odkaz na obnovení'}
        </button>
      </form>
    </main>
  )
}
