'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getAdminActiveBattles,
  getAdminCardTemplates,
  getAdminOnlinePlayers,
  getAdminPlayerCards,
  getAdminStatus,
  grantAdminCard,
  grantAdminXp,
  removeAdminCard,
  type AdminActiveBattleRow,
  type AdminCardTemplateOption,
  type AdminOnlinePlayerRow,
  type AdminPlayerCardRow,
} from '@/lib/admin/api'
import { levelForXp } from '@/lib/players/leveling'
import { NATIONS } from '@/lib/players/nations'
import { CollapsibleSection } from '@/components/admin/CollapsibleSection'
import { AdminCardThumbnail } from '@/components/admin/AdminCardThumbnail'
import AdminMovementsPanel from '@/components/admin/AdminMovementsPanel'
import { useSession } from '@/lib/supabase/useSession'

const CATEGORY_LABELS: Record<AdminCardTemplateOption['category'], string> = {
  unit: 'Jednotky',
  castle: 'Hrady',
  village: 'Vesnice',
  wall: 'Hradby',
  boost: 'Boost karty',
}

const ACTIVITY_LABELS = {
  attacker: 'Útočí v aktivní bitvě',
  defender: 'Brání se v aktivní bitvě',
} as const

function rankLabel(rank: string) {
  return rank.charAt(0).toUpperCase() + rank.slice(1)
}

function formatLastSeen(timestamp: string) {
  return new Date(timestamp).toLocaleString('cs-CZ')
}

function territoryLabel(card: AdminPlayerCardRow) {
  if (card.stationed_territory_id == null) return 'Inventář'
  if (card.territory_x == null || card.territory_y == null) return `Území #${card.stationed_territory_id}`
  return `(${card.territory_x}, ${card.territory_y}) · #${card.stationed_territory_id}`
}

export default function AdminPage() {
  const router = useRouter()
  const { user, loading } = useSession()

  const [adminChecked, setAdminChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  const [players, setPlayers] = useState<AdminOnlinePlayerRow[] | null>(null)
  const [battles, setBattles] = useState<AdminActiveBattleRow[] | null>(null)
  const [templates, setTemplates] = useState<AdminCardTemplateOption[] | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const [cardPlayerId, setCardPlayerId] = useState('')
  const [xpPlayerId, setXpPlayerId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [territoryIdInput, setTerritoryIdInput] = useState('')
  const [xpAmountInput, setXpAmountInput] = useState('50')

  const [playerCards, setPlayerCards] = useState<AdminPlayerCardRow[] | null>(null)
  const [playerCardsError, setPlayerCardsError] = useState<string | null>(null)
  const [cardMessage, setCardMessage] = useState<string | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)
  const [xpMessage, setXpMessage] = useState<string | null>(null)
  const [xpError, setXpError] = useState<string | null>(null)
  const [submittingCard, setSubmittingCard] = useState(false)
  const [submittingXp, setSubmittingXp] = useState(false)
  const [zoomedCard, setZoomedCard] = useState<AdminPlayerCardRow | null>(null)

  const selectedXpPlayer = useMemo(
    () => players?.find((player) => player.id === xpPlayerId) ?? null,
    [players, xpPlayerId],
  )

  const templatesByCategory = useMemo(() => {
    const grouped = new Map<AdminCardTemplateOption['category'], AdminCardTemplateOption[]>()
    for (const category of ['unit', 'castle', 'village', 'wall', 'boost'] as const) {
      grouped.set(category, [])
    }
    for (const template of templates ?? []) {
      grouped.get(template.category)?.push(template)
    }
    return grouped
  }, [templates])

  async function refreshAdminOverview() {
    const [playersResult, battlesResult, templatesResult] = await Promise.all([
      getAdminOnlinePlayers(),
      getAdminActiveBattles(),
      getAdminCardTemplates(),
    ])

    const firstError = playersResult.error ?? battlesResult.error ?? templatesResult.error
    if (firstError) {
      setPageError(firstError.message)
      return
    }

    const nextPlayers = playersResult.data ?? []
    const nextTemplates = templatesResult.data ?? []

    setPageError(null)
    setPlayers(nextPlayers)
    setBattles(battlesResult.data ?? [])
    setTemplates(nextTemplates)

    setCardPlayerId((current) => current || nextPlayers[0]?.id || '')
    setXpPlayerId((current) => current || nextPlayers[0]?.id || '')
    setTemplateId((current) => current || nextTemplates[0]?.id || '')
  }

  async function refreshPlayerCards(playerId: string) {
    setPlayerCards(null)
    setPlayerCardsError(null)
    const { data, error } = await getAdminPlayerCards(playerId)
    if (error) {
      setPlayerCardsError(error.message)
      return
    }
    setPlayerCards(data ?? [])
  }

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
    }
  }, [loading, user, router])

  useEffect(() => {
    if (loading || !user) return

    let cancelled = false

    getAdminStatus(user.id).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setAccessError(error.message)
        setIsAdmin(false)
      } else {
        setAccessError(null)
        setIsAdmin(Boolean(data?.is_admin))
      }
      setAdminChecked(true)
    })

    return () => {
      cancelled = true
    }
  }, [loading, user])

  useEffect(() => {
    if (!adminChecked || !isAdmin) return
    refreshAdminOverview()
  }, [adminChecked, isAdmin])

  useEffect(() => {
    if (!adminChecked || !isAdmin || !cardPlayerId) return
    refreshPlayerCards(cardPlayerId)
  }, [adminChecked, isAdmin, cardPlayerId])

  async function handleGrantCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cardPlayerId || !templateId) return

    const trimmedTerritoryId = territoryIdInput.trim()
    const parsedTerritoryId = trimmedTerritoryId === '' ? null : Number(trimmedTerritoryId)

    if (trimmedTerritoryId !== '' && !Number.isInteger(parsedTerritoryId)) {
      setCardError('ID území musí být celé číslo.')
      setCardMessage(null)
      return
    }

    setSubmittingCard(true)
    setCardError(null)
    setCardMessage(null)

    const { error } = await grantAdminCard(cardPlayerId, templateId, parsedTerritoryId)
    setSubmittingCard(false)

    if (error) {
      setCardError(error.message)
      return
    }

    await refreshPlayerCards(cardPlayerId)
    setCardMessage('Karta byla přidána.')
    setTerritoryIdInput('')
  }

  async function handleRemoveCard(card: AdminPlayerCardRow) {
    if (!window.confirm(`Opravdu odebrat kartu ${card.template_name}?`)) return

    setCardError(null)
    setCardMessage(null)
    const { error } = await removeAdminCard(card.instance_id)
    if (error) {
      setCardError(error.message)
      return
    }

    await refreshPlayerCards(cardPlayerId)
    setCardMessage('Karta byla odebrána.')
  }

  async function handleGrantXp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!xpPlayerId) return

    const parsedAmount = Number(xpAmountInput)
    if (!Number.isInteger(parsedAmount)) {
      setXpError('XP částka musí být celé číslo.')
      setXpMessage(null)
      return
    }

    setSubmittingXp(true)
    setXpError(null)
    setXpMessage(null)

    const { data, error } = await grantAdminXp(xpPlayerId, parsedAmount)
    setSubmittingXp(false)

    if (error) {
      setXpError(error.message)
      return
    }

    if (data != null) {
      setPlayers((current) =>
        current?.map((player) =>
          player.id === xpPlayerId ? { ...player, xp: data } : player,
        ) ?? current,
      )
    }

    setXpMessage('XP byla upravena.')
  }

  if (loading || !adminChecked || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  if (accessError) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-red-400 text-sm">{accessError}</p>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-bold">Nemáte oprávnění</h1>
        <p className="text-zinc-400 max-w-lg">
          Tato stránka je dostupná pouze pro administrátory testovacího dashboardu.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div>
          <Link href="/" className="underline text-sm text-zinc-400 hover:text-zinc-200">
            ← Domů
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Admin dashboard</h1>
          <p className="text-sm text-zinc-400">
            Interní nástroj pro testování hráčů, bitev, karet a XP přechodů.
          </p>
        </div>

        {pageError && <p className="text-red-400 text-sm">{pageError}</p>}

        <CollapsibleSection title="Online hráči" description="Přehled aktivity všech hráčů.">
          {!players ? (
            <p className="text-zinc-400">Načítám…</p>
          ) : players.length === 0 ? (
            <p className="text-zinc-400">Zatím nejsou žádní hráči.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-zinc-400">
                  <tr className="border-b border-zinc-800">
                    <th className="px-3 py-2 font-medium">Hráč</th>
                    <th className="px-3 py-2 font-medium">Národ</th>
                    <th className="px-3 py-2 font-medium">XP / Level</th>
                    <th className="px-3 py-2 font-medium">Stav</th>
                    <th className="px-3 py-2 font-medium">Naposledy online</th>
                    <th className="px-3 py-2 font-medium">Aktivita</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => {
                    const nation = NATIONS.find((item) => item.id === player.nation)
                    return (
                      <tr key={player.id} className="border-b border-zinc-900/80 align-top last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{player.display_name}</div>
                          <div className="text-xs text-zinc-500">{player.kingdom_name ?? 'Bez názvu'}</div>
                        </td>
                        <td className="px-3 py-2 text-zinc-300">{nation?.name ?? player.nation}</td>
                        <td className="px-3 py-2 text-zinc-300">
                          {player.xp} XP · Lv. {levelForXp(player.xp)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={player.is_online ? 'text-emerald-400' : 'text-zinc-500'}
                          >
                            {player.is_online ? 'Online' : 'Offline'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-300">{formatLastSeen(player.last_seen_at)}</td>
                        <td className="px-3 py-2 text-zinc-300">
                          {player.active_battle_role
                            ? ACTIVITY_LABELS[player.active_battle_role]
                            : 'Bez aktivní bitvy'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Aktivní bitvy" description="Všechny bitvy, které ještě neskončily.">
          {!battles ? (
            <p className="text-zinc-400">Načítám…</p>
          ) : battles.length === 0 ? (
            <p className="text-zinc-400">Žádné aktivní bitvy.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-zinc-400">
                  <tr className="border-b border-zinc-800">
                    <th className="px-3 py-2 font-medium">Území</th>
                    <th className="px-3 py-2 font-medium">Útočník</th>
                    <th className="px-3 py-2 font-medium">Obránce</th>
                    <th className="px-3 py-2 font-medium">Kolo</th>
                    <th className="px-3 py-2 font-medium">Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {battles.map((battle) => (
                    <tr key={battle.id} className="border-b border-zinc-900/80 last:border-0">
                      <td className="px-3 py-2">({battle.territory_x}, {battle.territory_y})</td>
                      <td className="px-3 py-2">{battle.attacker_display_name}</td>
                      <td className="px-3 py-2">{battle.defender_display_name ?? 'NPC'}</td>
                      <td className="px-3 py-2">{battle.current_round}</td>
                      <td className="px-3 py-2">{battle.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleSection>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <CollapsibleSection title="Správa karet" description="Přidej kartu hráči a volitelně ji hned přiřaď na konkrétní území.">
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleGrantCard}>
              <label className="flex flex-col gap-1 text-sm">
                Hráč pro karty
                <select
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                  value={cardPlayerId}
                  onChange={(event) => setCardPlayerId(event.target.value)}
                >
                  {(players ?? []).map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.display_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Karta
                <select
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {(['unit', 'castle', 'village', 'wall', 'boost'] as const).map((category) => {
                    const options = templatesByCategory.get(category) ?? []
                    if (options.length === 0) return null
                    return (
                      <optgroup key={category} label={CATEGORY_LABELS[category]}>
                        {options.map((template) => (
                          <option key={template.id} value={template.id}>
                            {`${rankLabel(template.rank)} · ${template.name}`}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                ID území (volitelné)
                <input
                  type="text"
                  inputMode="numeric"
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                  value={territoryIdInput}
                  onChange={(event) => setTerritoryIdInput(event.target.value)}
                />
              </label>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submittingCard || !cardPlayerId || !templateId}
                  className="rounded-full bg-zinc-100 px-5 py-2 font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Přidat kartu
                </button>
              </div>
            </form>

            {cardError && <p className="mt-4 text-sm text-red-400">{cardError}</p>}
            {cardMessage && <p className="mt-4 text-sm text-emerald-400">{cardMessage}</p>}

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Karty vybraného hráče</h3>
              {playerCardsError && <p className="mt-3 text-sm text-red-400">{playerCardsError}</p>}
              {!playerCards ? (
                <p className="mt-3 text-zinc-400">Načítám…</p>
              ) : playerCards.length === 0 ? (
                <p className="mt-3 text-zinc-400">Vybraný hráč zatím nemá žádné karty.</p>
              ) : (
                <div className="mt-4 max-h-[560px] overflow-y-auto">
                  <div className="grid grid-cols-3 gap-3">
                    {playerCards.map((card) => (
                      <div key={card.instance_id} className="relative">
                        <button
                          type="button"
                          aria-label={`Odebrat kartu ${card.template_name}`}
                          onClick={() => void handleRemoveCard(card)}
                          className="absolute left-1 top-1 z-10 rounded bg-red-900/80 px-1 text-xs text-red-200 hover:bg-red-700"
                        >
                          ×
                        </button>
                        <button
                          type="button"
                          aria-label={`Zvětšit kartu ${card.template_name}`}
                          onClick={() => setZoomedCard(card)}
                          className="absolute right-1 top-1 z-10 rounded bg-zinc-800/80 px-1 text-xs text-zinc-200 hover:bg-zinc-700"
                        >
                          🔍
                        </button>
                        <AdminCardThumbnail
                          name={card.template_name}
                          rank={card.template_rank}
                          category={card.template_category}
                        />
                        <p className="mt-1 text-xs text-zinc-400 text-center">
                          {rankLabel(card.template_rank)} · {card.template_category} · {territoryLabel(card)} · {card.status}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {zoomedCard && (
              <div
                className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
                onClick={() => setZoomedCard(null)}
              >
                <div
                  className="relative max-w-xs w-full p-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label="Zavřít"
                    onClick={() => setZoomedCard(null)}
                    className="absolute right-2 top-2 z-10 rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-700"
                  >
                    ×
                  </button>
                  <AdminCardThumbnail
                    name={zoomedCard.template_name}
                    rank={zoomedCard.template_rank}
                    category={zoomedCard.template_category}
                    size="lg"
                  />
                  <p className="mt-2 text-sm text-zinc-400 text-center">
                    {rankLabel(zoomedCard.template_rank)} · {zoomedCard.template_category} · {territoryLabel(zoomedCard)} · {zoomedCard.status}
                  </p>
                </div>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Správa XP" description="Přidej nebo odeber XP pro testování level-up i level-down přechodů.">
            <form className="flex flex-col gap-4" onSubmit={handleGrantXp}>
              <label className="flex flex-col gap-1 text-sm">
                Hráč pro XP
                <select
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                  value={xpPlayerId}
                  onChange={(event) => setXpPlayerId(event.target.value)}
                >
                  {(players ?? []).map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.display_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                XP částka
                <input
                  type="number"
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                  value={xpAmountInput}
                  onChange={(event) => setXpAmountInput(event.target.value)}
                />
              </label>

              <button
                type="submit"
                disabled={submittingXp || !xpPlayerId}
                className="rounded-full bg-zinc-100 px-5 py-2 font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Přidat XP
              </button>
            </form>

            {selectedXpPlayer && (
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
                <p className="font-semibold">{selectedXpPlayer.display_name}</p>
                <p className="text-zinc-400">
                  Aktuálně: {selectedXpPlayer.xp} XP · Level {levelForXp(selectedXpPlayer.xp)}
                </p>
              </div>
            )}

            {xpError && <p className="mt-4 text-sm text-red-400">{xpError}</p>}
            {xpMessage && <p className="mt-4 text-sm text-emerald-400">{xpMessage}</p>}
          </CollapsibleSection>
        </div>

        <CollapsibleSection title="Přesuny a zabírání území" description="Přehled všech aktivních a historických přesunů vojsk v herním světě.">
          <AdminMovementsPanel />
        </CollapsibleSection>
      </div>
    </main>
  )
}
