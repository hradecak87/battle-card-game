'use client'

/**
 * Shared display for a player's public profile fields (design spec §4/§6),
 * used by both `/profile/me` (with edit controls) and `/profile/[id]`
 * (read-only) so the two pages don't duplicate the level/nation/kingdom/
 * activity rendering logic.
 */

import { useState } from 'react'
import { NATIONS } from '@/lib/players/nations'
import { COATS_OF_ARMS } from '@/lib/players/coats-of-arms'
import { levelForXp, xpRequiredForLevel } from '@/lib/players/leveling'
import type { PlayerRow } from '@/lib/supabase/useSession'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000

export interface PlayerProfileCardProps {
  player: PlayerRow
  editable?: boolean
  onUpdateKingdom?: (kingdomName: string, coatOfArmsId: string) => Promise<{ error: string | null }>
}

export function PlayerProfileCard({ player, editable = false, onUpdateKingdom }: PlayerProfileCardProps) {
  const [editing, setEditing] = useState(false)
  const [kingdomName, setKingdomName] = useState(player.kingdom_name ?? '')
  const [coatOfArmsId, setCoatOfArmsId] = useState(player.coat_of_arms_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const level = levelForXp(player.xp)
  const xpAtLevelStart = xpRequiredForLevel(level)
  const xpAtNextLevel = xpRequiredForLevel(level + 1)
  const xpIntoLevel = player.xp - xpAtLevelStart
  const xpForLevel = xpAtNextLevel - xpAtLevelStart
  const progressPct = xpForLevel > 0 ? Math.min(100, (xpIntoLevel / xpForLevel) * 100) : 100

  const nation = NATIONS.find((n) => n.id === player.nation)
  const coat = COATS_OF_ARMS.find((c) => c.id === player.coat_of_arms_id)

  const isOnline = Date.now() - new Date(player.last_seen_at).getTime() < ONLINE_THRESHOLD_MS
  const isNpc = Boolean(player.is_npc)
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(player.created_at).getTime()) / (24 * 60 * 60 * 1000),
  )
  const playtimeHours = Math.floor(player.total_playtime_seconds / 3600)
  const playtimeMinutes = Math.floor((player.total_playtime_seconds % 3600) / 60)

  async function handleSaveKingdom() {
    if (!onUpdateKingdom) return
    setError(null)
    setSubmitting(true)
    const { error: updateError } = await onUpdateKingdom(kingdomName, coatOfArmsId)
    setSubmitting(false)
    if (updateError) {
      setError(updateError)
      return
    }
    setEditing(false)
  }

  return (
    <div className="w-full max-w-xl flex flex-col gap-6 rounded-lg border border-zinc-800 p-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 shrink-0">{coat ? <coat.Svg /> : null}</div>
        <div>
          <h1 className="text-xl font-bold">{player.display_name}</h1>
          <p className="text-zinc-400 text-sm">
            {isNpc ? (
              <span
                data-testid="npc-badge"
                className="inline-flex rounded-full border border-fuchsia-500/60 bg-fuchsia-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-fuchsia-200"
              >
                NPC
              </span>
            ) : (
              <span data-testid="online-badge" className={isOnline ? 'text-emerald-400' : 'text-zinc-500'}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            )}
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm text-zinc-400 mb-1">
          Level {level} &middot; {player.xp} XP
        </p>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-zinc-100"
            style={{ width: `${progressPct}%` }}
            data-testid="xp-progress-bar"
          />
        </div>
      </div>

      {nation && (
        <div>
          <p className="font-semibold">{nation.name}</p>
          <p className="text-sm text-zinc-400">{nation.perkDescription}</p>
        </div>
      )}

      <div>
        <p className="font-semibold">{player.kingdom_name ?? 'Bez názvu'}</p>
        {editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm underline mt-1">
            Upravit království
          </button>
        )}
        {editable && editing && (
          <div className="flex flex-col gap-2 mt-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Název království</span>
              <input
                type="text"
                minLength={3}
                maxLength={30}
                value={kingdomName}
                onChange={(e) => setKingdomName(e.target.value)}
                className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-5 gap-2">
              {COATS_OF_ARMS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`Erb: ${c.label}`}
                  aria-pressed={coatOfArmsId === c.id}
                  onClick={() => setCoatOfArmsId(c.id)}
                  className={`aspect-square rounded p-1 border ${
                    coatOfArmsId === c.id ? 'border-zinc-100' : 'border-zinc-700'
                  }`}
                >
                  <c.Svg />
                </button>
              ))}
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveKingdom}
                className="rounded-full bg-zinc-100 text-zinc-900 px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? 'Ukládám…' : 'Uložit'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full border border-zinc-600 px-4 py-1.5 text-sm"
              >
                Zrušit
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-zinc-500">Účet aktivní</p>
          <p>{accountAgeDays} {accountAgeDays === 1 ? 'den' : 'dní'}</p>
        </div>
        <div>
          <p className="text-zinc-500">Herní doba</p>
          <p>{playtimeHours}h {playtimeMinutes}m</p>
        </div>
        <div>
          <p className="text-zinc-500">Naposledy online</p>
          <p>{new Date(player.last_seen_at).toLocaleString('cs-CZ')}</p>
        </div>
      </div>
    </div>
  )
}
