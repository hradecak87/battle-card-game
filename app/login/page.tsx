'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNeedsConfirmation(false)
    setResent(false)
    setSubmitting(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (signInError) {
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        setNeedsConfirmation(true)
      } else {
        setError(signInError.message)
      }
      return
    }
    router.push('/profile/me')
  }

  async function handleResend() {
    await supabase.auth.resend({ type: 'signup', email })
    setResent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center mb-2">Přihlásit se</h1>

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

        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Heslo</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </label>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {needsConfirmation && (
          <div className="text-amber-400 text-sm flex flex-col gap-1">
            <p>Nejdřív prosím potvrď e-mail (odkaz jsme ti poslali při registraci).</p>
            {resent ? (
              <p>Potvrzovací e-mail znovu odeslán.</p>
            ) : (
              <button type="button" onClick={handleResend} className="underline text-left">
                Poslat znovu
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors disabled:opacity-50"
        >
          {submitting ? 'Přihlašuji…' : 'Přihlásit se'}
        </button>

        <p className="text-sm text-zinc-500 text-center">
          <Link href="/reset-password" className="underline">Zapomenuté heslo?</Link>
        </p>
        <p className="text-sm text-zinc-500 text-center">
          Nemáš království? <Link href="/register" className="underline">Založit ho</Link>
        </p>
      </form>
    </main>
  )
}
