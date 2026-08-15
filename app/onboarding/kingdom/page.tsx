'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { COATS_OF_ARMS } from '@/lib/players/coats-of-arms'

export default function KingdomOnboardingPage() {
  const router = useRouter()
  const [kingdomName, setKingdomName] = useState('')
  const [coatOfArmsId, setCoatOfArmsId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!coatOfArmsId) {
      setError('Vyber si erb.')
      return
    }
    setSubmitting(true)
    const { error: rpcError } = await supabase.rpc('complete_kingdom_onboarding', {
      new_kingdom_name: kingdomName,
      new_coat_of_arms_id: coatOfArmsId,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    router.push('/profile/me')
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-8 gap-6">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-center">Založ své království</h1>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Název tvého království</span>
          <input
            type="text"
            required
            minLength={3}
            maxLength={30}
            value={kingdomName}
            onChange={(e) => setKingdomName(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-zinc-400">Vyber si erb</span>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {COATS_OF_ARMS.map((coat) => (
              <button
                key={coat.id}
                type="button"
                aria-label={`Erb: ${coat.label}`}
                aria-pressed={coatOfArmsId === coat.id}
                onClick={() => setCoatOfArmsId(coat.id)}
                className={`aspect-square rounded p-1 border transition-colors ${
                  coatOfArmsId === coat.id
                    ? 'border-zinc-100 bg-zinc-800'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <coat.Svg />
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors disabled:opacity-50"
        >
          {submitting ? 'Zakládám…' : 'Založit království'}
        </button>
      </form>
    </main>
  )
}
