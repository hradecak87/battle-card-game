import type { CardInstanceWithTemplate } from '@/lib/territories/api'
import type { Rank } from '@/lib/cards/types'

export type MaskedUnitBucketCounts = Partial<Record<Rank, number>>

function bucketLabel(count: number) {
  if (count >= 11) return '11+'
  if (count >= 6) return '6–10'
  return '1–5'
}

export function formatMaskedUnitBuckets(counts: MaskedUnitBucketCounts): string | null {
  const order: Rank[] = ['common', 'uncommon', 'rare', 'epic', 'legend']
  const parts = order
    .flatMap((rank) => {
      const count = counts[rank] ?? 0
      return count > 0 ? [`${bucketLabel(count)} ${rank}`] : []
    })

  return parts.length > 0 ? parts.join(', ') : null
}

export function summarizeMaskedUnitBuckets(
  instances: Pick<CardInstanceWithTemplate, 'is_masked' | 'card_templates'>[]
): string | null {
  const counts = instances.reduce<MaskedUnitBucketCounts>((acc, instance) => {
    const row = instance.card_templates
    if (!instance.is_masked || row?.category !== 'unit') return acc
    const rank = row.rank as Rank
    acc[rank] = (acc[rank] ?? 0) + 1
    return acc
  }, {})

  return formatMaskedUnitBuckets(counts)
}

export function maskedUnitBucketCounts(
  instances: Pick<CardInstanceWithTemplate, 'is_masked' | 'card_templates'>[]
): MaskedUnitBucketCounts {
  return instances.reduce<MaskedUnitBucketCounts>((acc, instance) => {
    const row = instance.card_templates
    if (!instance.is_masked || row?.category !== 'unit') return acc
    const rank = row.rank as Rank
    const nextCount = (acc[rank] ?? 0) + 1
    acc[rank] = nextCount >= 11 ? 3 : nextCount >= 6 ? 2 : 1
    return acc
  }, {})
}
