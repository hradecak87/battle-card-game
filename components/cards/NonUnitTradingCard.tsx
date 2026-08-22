import { BoostCardTemplate, Rank, ScoutCardTemplate, StructureCardTemplate } from '@/lib/cards/types'
import { boostEffectSummary, boostTypeLabel } from '@/lib/cards/boosts'
import { hasIllustratedBoostArt, illustratedBoostArtSrc } from '@/lib/cards/illustrated-boost-art'
import { RANK_FRAME } from './TradingCard'
import { pickVariant, CASTLE_VARIANTS, VILLAGE_VARIANTS } from '@/components/territories/icons/StructureIcons'

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

const SCOUT_LABEL = 'Průzkumná karta'

// Emoji placeholder standing in for real illustrated boost artwork (to be
// generated later, per the user's request) — one per boost "flavor" so the
// art panel isn't a blank rectangle in the meantime. Castle/Village/Wall
// cards instead reuse the same hand-drawn illustrations shown for that
// structure on the territory map (components/territories/icons), since
// those already exist and look identical either way.
function boostArtIcon(boostType: BoostCardTemplate['boostType']) {
  return boostType === 'territorial' ? '🛡️' : '⚔️'
}

/**
 * Renders the same hand-drawn illustration used for this structure on the
 * territory map (public/icons/structures/*.png) — a plain <img> rather
 * than the next/image-based map icon components, since those require a
 * fixed width/height that wouldn't scale with this card's cqw-based
 * responsive sizing (same rationale as TradingCard's illustrated unit
 * art). Castle/Village have 3 variants each — picked deterministically
 * from the template id (stable across renders/reloads, mirroring how the
 * map picks a variant per territory id) since a card template has no
 * per-instance territory id of its own. Wall has a single illustration.
 */
function StructureArt({ category, id }: { category: StructureCardTemplate['category']; id: string }) {
  const variant =
    category === 'castle'
      ? pickVariant(id, CASTLE_VARIANTS)
      : category === 'village'
        ? pickVariant(id, VILLAGE_VARIANTS)
        : 'wall'
  const title = STRUCTURE_LABELS[category]

  // eslint-disable-next-line @next/next/no-img-element -- many cards render
  // at once in grids; plain <img> avoids next/image's per-instance
  // lazy-load/placeholder overhead (same rationale as TradingCard).
  return <img src={`/icons/structures/${variant}.png`} alt={title} className="h-full w-full object-contain" />
}

interface StatColumn {
  label: string
  value?: string
  /** null/0/undefined all render as a blank value — only the label stays. */
  percentValue?: number | null | undefined
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
          <dd className="font-mono font-semibold text-[6.3cqw]">
            {stat.value ?? (stat.percentValue ? `+${stat.percentValue}%` : '')}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface NonUnitTradingCardProps {
  template: StructureCardTemplate | BoostCardTemplate | ScoutCardTemplate
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
  const isScout = template.category === 'scout'

  const typeLabel = isBoost
    ? boostTypeLabel(template.boostType)
    : isScout
      ? SCOUT_LABEL
      : STRUCTURE_LABELS[template.category]

  const stats: StatColumn[] = isBoost
    ? [
        { label: 'STR', percentValue: template.pctStr },
        { label: 'LNG', percentValue: template.pctLng },
        { label: 'DEF', percentValue: template.pctDef },
        { label: 'HP', percentValue: template.pctHp },
      ]
    : isScout
      ? [
          { label: 'STR', value: '—' },
          { label: 'LNG', value: '—' },
          { label: 'DEF', value: '—' },
          { label: 'HP', value: '—' },
        ]
      : [
          { label: 'ATK', percentValue: template.attackBonusPct },
          { label: 'DEF', percentValue: template.defenseBonusPct },
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
        {isBoost ? (
          hasIllustratedBoostArt(template.id) ? (
            // eslint-disable-next-line @next/next/no-img-element -- many cards
            // render at once in grids; plain <img> avoids next/image's
            // per-instance lazy-load/placeholder overhead (same rationale as
            // TradingCard's illustrated unit art).
            <img
              src={illustratedBoostArtSrc(template.id)}
              alt={template.name}
              className="h-full w-full object-contain p-[6%]"
            />
          ) : (
            <span aria-hidden="true" className="text-[16cqw] leading-none opacity-80">
              {boostArtIcon(template.boostType)}
            </span>
          )
        ) : isScout ? (
          <span aria-label="Ikona zvěda" className="text-[16cqw] leading-none opacity-80">
            🕵️
          </span>
        ) : (
          <div className="relative h-full w-full p-[12%]">
            <StructureArt category={template.category} id={template.id} />
          </div>
        )}
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
