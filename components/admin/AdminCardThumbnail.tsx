import { RANK_FRAME } from '@/components/cards/TradingCard'

type Category = 'unit' | 'castle' | 'village' | 'wall' | 'boost' | 'scout'

const CATEGORY_LABELS: Record<Category, string> = {
  unit: 'Jednotky',
  castle: 'Hrady',
  village: 'Vesnice',
  wall: 'Hradby',
  boost: 'Boost',
  scout: 'Zvěd',
}

const RANK_LABELS: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legend: 'Legend',
}

interface AdminCardThumbnailProps {
  name: string
  rank: string
  category: Category
  size?: 'sm' | 'lg'
}

export function AdminCardThumbnail({ name, rank, category, size = 'sm' }: AdminCardThumbnailProps) {
  const frame = RANK_FRAME[rank as keyof typeof RANK_FRAME] ?? RANK_FRAME.common
  const isLg = size === 'lg'

  return (
    <div
      data-size={isLg ? 'lg' : undefined}
      className={`border-2 ${frame.border} rounded-lg aspect-[5/7] flex flex-col justify-between ${isLg ? 'p-4 text-base' : 'p-2 text-xs'}`}
    >
      <span className="text-zinc-400">{CATEGORY_LABELS[category]}</span>
      <span className={`font-semibold text-center ${isLg ? 'text-lg' : 'text-xs'} break-words`}>{name}</span>
      <span className="text-zinc-400 text-right">{RANK_LABELS[rank] ?? rank}</span>
    </div>
  )
}
