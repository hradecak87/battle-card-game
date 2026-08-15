'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { NATIONS, type NationId } from '@/lib/players/nations'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nation, setNation] = useState<NationId>(NATIONS[0].id)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [registered, setRegistered] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, nation } },
    })
    setSubmitting(false)
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    setRegistered(true)
  }

  if (registered) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-bold mb-3">Zkontroluj svůj e-mail</h1>
          <p className="text-zinc-400">
            Poslali jsme ti potvrzovací odkaz na <strong>{email}</strong>.
            Po jeho potvrzení se budeš moci přihlásit.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center mb-2">Založit království</h1>

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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Přezdívka</span>
          <input
            type="text"
            required
            minLength={3}
            maxLength={30}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-zinc-400 mb-1">
            Národ (volba je trvalá, nelze později změnit)
          </legend>
          {NATIONS.map((n) => (
            <label
              key={n.id}
              className={`flex flex-col gap-0.5 rounded border px-3 py-2 cursor-pointer ${
                nation === n.id ? 'border-zinc-100' : 'border-zinc-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="nation"
                  value={n.id}
                  checked={nation === n.id}
                  onChange={() => setNation(n.id)}
                />
                <span className="font-semibold">{n.name}</span>
              </span>
              <span className="text-xs text-zinc-500 ml-6">{n.perkDescription}</span>
            </label>
          ))}
        </fieldset>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors disabled:opacity-50"
        >
          {submitting ? 'Zakládám…' : 'Založit království'}
        </button>

        <p className="text-sm text-zinc-500 text-center">
          Už máš království? <Link href="/login" className="underline">Přihlásit se</Link>
        </p>
      </form>
    </main>
  )
}
