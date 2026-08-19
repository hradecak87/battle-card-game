import { boostEffectSummary, boostTypeLabel, RANK_LABELS } from '@/lib/cards/boosts'
import { BoostCardTemplate, Rank } from '@/lib/cards/types'

const RANK_STYLES: Record<Rank, string> = {
  common: 'border-zinc-500 bg-zinc-900/80 text-zinc-100',
  uncommon: 'border-green-600 bg-green-950/40 text-green-100',
  rare: 'border-blue-600 bg-blue-950/40 text-blue-100',
  epic: 'border-purple-600 bg-purple-950/40 text-purple-100',
  legend: 'border-yellow-500 bg-yellow-950/40 text-yellow-100',
}

interface VisibleBoostCardTileProps {
  template: BoostCardTemplate
  compact?: boolean
}

interface MaskedBoostSummaryTileProps {
  rank: Rank
  count: number
}

export function VisibleBoostCardTile({ template, compact = false }: VisibleBoostCardTileProps) {
  return (
    <div
      className={`rounded-xl border p-3 ${RANK_STYLES[template.rank]} ${compact ? 'text-xs' : 'text-sm'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{template.name}</p>
          <p className="text-[11px] opacity-80">{boostTypeLabel(template.boostType)}</p>
        </div>
        <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold">
          {RANK_LABELS[template.rank]}
        </span>
      </div>
      <p className="mt-2 text-[11px] opacity-90">{boostEffectSummary(template)}</p>
      {!compact && <p className="mt-2 text-[11px] opacity-75 italic">{template.flavorText}</p>}
    </div>
  )
}

export function MaskedBoostSummaryTile({ rank, count }: MaskedBoostSummaryTileProps) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${RANK_STYLES[rank]}`}>
      <p className="font-semibold">{RANK_LABELS[rank]} ×{count}</p>
      <p className="text-[11px] opacity-80">Skrytá boost karta soupeře</p>
    </div>
  )
}
