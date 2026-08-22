import { BoostCardTemplate, Rank, StructureCardTemplate } from '@/lib/cards/types'
import { boostEffectSummary, boostTypeLabel } from '@/lib/cards/boosts'
import { RANK_FRAME } from './TradingCard'

const RANK_LABELS: Record<Rank, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legend: 'Legend',
}

const STRUCTURE_LABELS: Record<StructureCardTemplate['category'], string> = {
  castle: 'Hrad',
  village: 'Vesnice',
  wall: 'Hradby',
}

// Emoji placeholders standing in for real illustrated artwork (to be
// generated later, per the user's request) — one per card "flavor" so the
// art panel isn't a blank rectangle in the meantime.
const STRUCTURE_ART_ICON: Record<StructureCardTemplate['category'], string> = {
  castle: '🏰',
  village: '🏘️',
  wall: '🧱',
}

function boostArtIcon(boostType: BoostCardTemplate['boostType']) {
  return boostType === 'territorial' ? '🛡️' : '⚔️'
}

interface StatColumn {
  label: string
  /** null/0/undefined all render as a blank value — only the label stays. */
  value: number | null | undefined
}

function StatRow({ stats }: { stats: StatColumn[] }) {
  return (
    <dl
      className="grid gap-[0.75cqw] text-center text-[4.8cqw] border-t border-zinc-700 pt-[1.5cqw]"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-zinc-500">{stat.label}</dt>
          <dd className="font-mono font-semibold text-[6.3cqw]">{stat.value ? `+${stat.value}%` : ''}</dd>
        </div>
      ))}
    </dl>
  )
}

interface NonUnitTradingCardProps {
  template: StructureCardTemplate | BoostCardTemplate
  /** Compact mode: smaller footprint, matches TradingCard's compact mode (no flavor text/supply line). */
  compact?: boolean
}

/**
 * Boost- and structure-card counterpart to `TradingCard`, sharing the exact
 * same frame/layout (art panel + rank badge, title, type label, flavor
 * text, stat row, supply footer) so every card in the game reads
 * consistently regardless of category — see
 * docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md
 * for the original unit-only layout this mirrors. Stats are percentages
 * (these cards have no raw combat stats of their own), and a stat column
 * with no bonus still shows its label with a blank value rather than being
 * omitted, so the stat row shape stays stable across a card type's own
 * cards.
 */
export function NonUnitTradingCard({ template, compact = false }: NonUnitTradingCardProps) {
  const frame = RANK_FRAME[template.rank]
  const isBoost = template.category === 'boost'

  const typeLabel = isBoost ? boostTypeLabel(template.boostType) : STRUCTURE_LABELS[template.category]
  const artIcon = isBoost ? boostArtIcon(template.boostType) : STRUCTURE_ART_ICON[template.category]

  const stats: StatColumn[] = isBoost
    ? [
        { label: 'STR', value: template.pctStr },
        { label: 'LNG', value: template.pctLng },
        { label: 'DEF', value: template.pctDef },
        { label: 'HP', value: template.pctHp },
      ]
    : [
        { label: 'ATK', value: template.attackBonusPct },
        { label: 'DEF', value: template.defenseBonusPct },
      ]

  const flavorText = isBoost && template.effectKind === 'instant_effect'
    ? template.flavorText || boostEffectSummary(template)
    : template.flavorText

  return (
    <div
      className={`[container-type:inline-size] aspect-[5/7] w-full rounded-xl border-[5px] ${frame.border} bg-zinc-900 flex flex-col overflow-hidden`}
      style={{
        boxShadow: [`inset 0 0 15px 2px ${frame.fadeColor}`, frame.glow].filter(Boolean).join(', '),
      }}
    >
      <div
        className="relative h-[38%] shrink-0 flex items-center justify-center"
        style={{
          background: `radial-gradient(ellipse at 50% 45%, ${frame.fadeColor} 0%, rgba(24,24,27,1) 100%)`,
        }}
      >
        <span aria-hidden="true" className="text-[16cqw] leading-none opacity-80">
          {artIcon}
        </span>
        <span
          className={`absolute top-1 right-1 text-[5.4cqw] font-bold px-[1.8cqw] py-[0.6cqw] rounded-full ${frame.badgeBg} ${frame.badgeText}`}
        >
          {RANK_LABELS[template.rank]}
        </span>
      </div>

      <div className="flex-1 min-h-0 p-[3.3cqw] flex flex-col gap-[1.2cqw] overflow-hidden">
        <h3
          className={`font-bold leading-tight line-clamp-2 ${compact ? 'text-[7.2cqw]' : 'text-[8.25cqw]'}`}
        >
          {template.name}
        </h3>
        <p className="text-[5.7cqw] text-zinc-400 leading-none">{typeLabel}</p>

        {!compact && (
          <p className="text-[5.1cqw] leading-snug text-zinc-300 italic line-clamp-3">{flavorText}</p>
        )}

        <div className="mt-auto">
          <StatRow stats={stats} />

          {!compact && (
            <p className="text-[4.8cqw] text-zinc-500 mt-[0.75cqw] truncate">
              {template.totalSupply === null ? 'Neomezeno' : `Existuje jen ${template.totalSupply}×`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
