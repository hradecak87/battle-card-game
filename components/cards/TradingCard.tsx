import { UnitCardTemplate, EffectiveCard, Rank, UnitType } from '@/lib/cards/types'
import { UnitArt } from './unit-art'

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

/**
 * Rank frame theme (spec: user-requested classic TCG rarity colors):
 * common=gray, uncommon=green, rare=blue, epic=purple, legend=gold.
 */
const RANK_FRAME: Record<
  Rank,
  { border: string; badgeBg: string; badgeText: string; glow: string }
> = {
  common: {
    border: 'border-zinc-400',
    badgeBg: 'bg-zinc-400',
    badgeText: 'text-zinc-900',
    glow: '',
  },
  uncommon: {
    border: 'border-green-500',
    badgeBg: 'bg-green-500',
    badgeText: 'text-green-50',
    glow: '',
  },
  rare: {
    border: 'border-blue-500',
    badgeBg: 'bg-blue-500',
    badgeText: 'text-blue-50',
    glow: '',
  },
  epic: {
    border: 'border-purple-500',
    badgeBg: 'bg-purple-500',
    badgeText: 'text-purple-50',
    glow: '',
  },
  legend: {
    border: 'border-yellow-400',
    badgeBg: 'bg-yellow-400',
    badgeText: 'text-yellow-950',
    glow: 'shadow-[0_0_16px_rgba(250,204,21,0.45)]',
  },
}

interface TradingCardProps {
  template: UnitCardTemplate
  stats: EffectiveCard
  /** Compact mode: smaller footprint for the arena side-by-side layout. */
  compact?: boolean
  /** Design proof-of-concept toggle — see UnitArt. */
  artVariant?: 'emblem' | 'figure'
}

export function TradingCard({
  template,
  stats,
  compact = false,
  artVariant = 'emblem',
}: TradingCardProps) {
  const frame = RANK_FRAME[template.rank]

  return (
    // Fixed classic trading-card proportions (2.5" x 3.5" poker size ≈ 5:7)
    // so the card always keeps the same paper-card shape at any size —
    // width alone determines height, never the amount of text inside.
    // All text/spacing below is sized in `cqw` (container query width)
    // units against the `@container` on this root div, so everything scales
    // proportionally with the card's own rendered width (not the viewport) —
    // a card rendered twice as wide gets text twice as large, and the
    // no-overflow guarantee holds at any size, not just one fixed width.
    <div
      className={`[container-type:inline-size] aspect-[5/7] w-full rounded-xl border-[5px] ${frame.border} ${frame.glow} bg-zinc-900 flex flex-col overflow-hidden`}
    >
      <div className="relative h-[38%] shrink-0">
        <UnitArt unitType={template.unitType} variant={artVariant} />
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
        <p className="text-[5.7cqw] text-zinc-400 leading-none">
          {UNIT_TYPE_LABELS[template.unitType]}
        </p>

        {!compact && (
          <p className="text-[5.1cqw] leading-snug text-zinc-300 italic line-clamp-3">
            {template.flavorText}
          </p>
        )}

        {/* Pushed to the bottom of the (now fixed-height) content area so the
            stat line lines up across every card, regardless of how many
            lines the name/flavor text wrap to. */}
        <div className="mt-auto">
          <dl className="grid grid-cols-4 gap-[0.75cqw] text-center text-[4.8cqw] border-t border-zinc-700 pt-[1.5cqw]">
            <div>
              <dt className="text-zinc-500">STR</dt>
              <dd className="font-mono font-semibold text-[6.3cqw]">{stats.str}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">LNG</dt>
              <dd className="font-mono font-semibold text-[6.3cqw]">{stats.lng}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">DEF</dt>
              <dd className="font-mono font-semibold text-[6.3cqw]">{stats.def}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">HP</dt>
              <dd className="font-mono font-semibold text-[6.3cqw]">{stats.hp}</dd>
            </div>
          </dl>

          {!compact && (
            <p className="text-[4.8cqw] text-zinc-500 mt-[0.75cqw] truncate">
              {template.totalSupply === null
                ? 'Neomezeno'
                : `Existuje jen ${template.totalSupply}×`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
