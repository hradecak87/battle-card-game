'use client'

import { useMemo, useState } from 'react'
import { getAllTemplates } from '@/lib/cards/catalog'
import { applyRank, DuelBreakdown, resolveDuelWithBreakdown } from '@/lib/cards/combat'
import { CardTemplate, Rank, UnitType } from '@/lib/cards/types'

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  archers: 'Lučištníci',
  crossbowmen: 'Kušiníci',
  spearmen: 'Oštěpníci',
  swordsmen: 'Šermíři',
  halberdiers: 'Halapartníci',
  knights: 'Rytíři',
  lightCavalry: 'Lehká jízda',
  siegeEngines: 'Obléhací stroje',
}

const RANK_LABELS: Record<Rank, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legend: 'Legend',
}

function optionLabel(t: CardTemplate): string {
  return `${t.name} — ${UNIT_TYPE_LABELS[t.unitType]} (${RANK_LABELS[t.rank]})`
}

function formatTtk(ttk: number): string {
  return ttk === Infinity ? '∞' : ttk.toFixed(2)
}

interface SideResultProps {
  title: string
  templateName: string
  result: DuelBreakdown['attacker']
  isWinner: boolean
}

function SideResult({ title, templateName, result, isWinner }: SideResultProps) {
  return (
    <div
      className={`rounded-lg border p-4 flex-1 ${
        isWinner ? 'border-amber-500 bg-amber-950/30' : 'border-zinc-700 bg-zinc-900'
      }`}
    >
      <p className="text-xs text-zinc-400">{title}</p>
      <h3 className="font-semibold mb-2">{templateName}</h3>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <dt className="text-zinc-500">ATK</dt>
          <dd className="font-mono font-semibold">{result.atk}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">DMG</dt>
          <dd className="font-mono font-semibold">{result.dmgDealt}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">TTK</dt>
          <dd className="font-mono font-semibold">{formatTtk(result.ttk)}</dd>
        </div>
      </dl>
      {isWinner && <p className="text-amber-400 text-xs font-semibold mt-2">VÍTĚZ</p>}
    </div>
  )
}

export default function ArenaPage() {
  const allTemplates = useMemo(() => getAllTemplates(), [])

  const [attackerId, setAttackerId] = useState(allTemplates[0]?.id ?? '')
  const [defenderId, setDefenderId] = useState(allTemplates[1]?.id ?? '')
  const [result, setResult] = useState<DuelBreakdown | null>(null)

  const attackerTemplate = allTemplates.find((t) => t.id === attackerId)
  const defenderTemplate = allTemplates.find((t) => t.id === defenderId)

  const handleFight = () => {
    if (!attackerTemplate || !defenderTemplate) return
    const attackerStats = applyRank(attackerTemplate.baseStats, attackerTemplate.rank)
    const defenderStats = applyRank(defenderTemplate.baseStats, defenderTemplate.rank)
    setResult(resolveDuelWithBreakdown(attackerStats, defenderStats))
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <h1 className="text-2xl font-bold mb-1">Aréna soubojů</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Vyber dvě karty a vyzkoušej, jak mezi sebou bojují (1v1 souboj, spec §7).
      </p>

      <div className="flex flex-wrap gap-4 mb-6">
        <label className="flex flex-col gap-1 text-sm">
          Útočník
          <select
            aria-label="Útočník"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[16rem]"
            value={attackerId}
            onChange={(e) => {
              setAttackerId(e.target.value)
              setResult(null)
            }}
          >
            {allTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {optionLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Obránce
          <select
            aria-label="Obránce"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[16rem]"
            value={defenderId}
            onChange={(e) => {
              setDefenderId(e.target.value)
              setResult(null)
            }}
          >
            {allTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {optionLabel(t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={handleFight}
        className="rounded-full bg-red-700 hover:bg-red-600 text-white px-6 py-2 font-semibold mb-8"
      >
        Souboj!
      </button>

      {result && attackerTemplate && defenderTemplate && (
        <div className="flex flex-col sm:flex-row gap-4 max-w-3xl">
          <SideResult
            title="Útočník"
            templateName={attackerTemplate.name}
            result={result.attacker}
            isWinner={result.winner === 'attacker'}
          />
          <SideResult
            title="Obránce"
            templateName={defenderTemplate.name}
            result={result.defender}
            isWinner={result.winner === 'defender'}
          />
        </div>
      )}
    </main>
  )
}
