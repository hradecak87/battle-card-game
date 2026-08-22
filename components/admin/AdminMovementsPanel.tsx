'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  getAdminMovements,
  adminSpeedUpMovement,
  type AdminMovementRow,
} from '@/lib/admin/api'
import { formatEta } from '@/lib/time/formatEta'

const KIND_LABELS: Record<AdminMovementRow['kind'], string> = {
  transfer: 'Přesun',
  claim: 'Zabírání',
  attack: 'Útok',
  loan: 'Půjčka',
  loan_return: 'Vrácení půjčky',
}

type NpcFilter = 'all' | 'npc' | 'players'

export default function AdminMovementsPanel() {
  const [movements, setMovements] = useState<AdminMovementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeHistory, setIncludeHistory] = useState(false)
  const [npcFilter, setNpcFilter] = useState<NpcFilter>('all')
  const [search, setSearch] = useState('')
  const [speedingUpId, setSpeedingUpId] = useState<string | null>(null)

  async function load(hist: boolean) {
    const { data, error: err } = await getAdminMovements(hist)
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setMovements(data ?? [])
  }

  useEffect(() => {
    void load(includeHistory)
  }, [includeHistory])

  const filteredMovements = useMemo(() => {
    if (!movements) return []
    return movements.filter((m) => {
      if (npcFilter === 'npc' && !m.player_is_npc) return false
      if (npcFilter === 'players' && m.player_is_npc) return false
      if (search && !m.player_display_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [movements, npcFilter, search])

  async function handleSpeedUp(movementId: string) {
    setSpeedingUpId(movementId)
    try {
      const { error: err } = await adminSpeedUpMovement(movementId)
      if (err) {
        setError(err.message)
        return
      }
      await load(includeHistory)
    } finally {
      setSpeedingUpId(null)
    }
  }

  const isActive = (m: AdminMovementRow) => m.status === 'in_transit' || m.status === 'occupying'

  function etaFor(m: AdminMovementRow): string {
    if (m.status === 'occupying' && m.kind === 'claim' && m.claim_occupation_completes_at) {
      return formatEta(m.claim_occupation_completes_at)
    }
    return formatEta(m.transfer_arrives_at)
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* NPC toggle */}
        <div className="flex rounded border border-zinc-700 overflow-hidden">
          {(['all', 'npc', 'players'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setNpcFilter(f)}
              className={`px-3 py-1 ${npcFilter === f ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            >
              {f === 'all' ? 'Vše' : f === 'npc' ? 'Jen NPC' : 'Jen hráči'}
            </button>
          ))}
        </div>

        {/* Player name search */}
        <input
          type="text"
          placeholder="Hráč..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100"
        />

        {/* Include history */}
        <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)}
            aria-label="Zobrazit i dokončené/zrušené"
          />
          Zobrazit i dokončené/zrušené
        </label>
      </div>

      {!movements ? (
        <p className="text-zinc-400">Načítám…</p>
      ) : filteredMovements.length === 0 ? (
        <p className="text-zinc-400">Žádné přesuny.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-400">
              <tr className="border-b border-zinc-800">
                <th className="px-3 py-2">Hráč</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Odkud → Kam</th>
                <th className="px-3 py-2">Stav</th>
                <th className="px-3 py-2">ETA</th>
                <th className="px-3 py-2">Jednotky</th>
                <th className="px-3 py-2">Akce</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovements.map((m) => (
                <tr key={m.id} className="border-b border-zinc-900/80 last:border-0">
                  <td className="px-3 py-2">
                    <span>{m.player_display_name}</span>
                    {m.player_is_npc && (
                      <span className="ml-1 rounded bg-zinc-700 px-1 text-xs text-zinc-300">NPC</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{KIND_LABELS[m.kind]}</td>
                  <td className="px-3 py-2 text-zinc-300">
                    ({m.origin_x}, {m.origin_y}) → ({m.destination_x}, {m.destination_y})
                  </td>
                  <td className="px-3 py-2">{m.status}</td>
                  <td className="px-3 py-2 text-zinc-300">
                    {isActive(m) ? etaFor(m) : '—'}
                  </td>
                  <td className="px-3 py-2">{m.unit_count}</td>
                  <td className="px-3 py-2">
                    {isActive(m) && (
                      <button
                        type="button"
                        aria-label="Urychlit na 10s"
                        onClick={() => void handleSpeedUp(m.id)}
                        disabled={speedingUpId === m.id}
                        className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {speedingUpId === m.id ? '…' : '⏩'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
